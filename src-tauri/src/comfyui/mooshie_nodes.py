"""
MooshieUI custom nodes — lightweight face detection + in-memory image output.
Replaces the heavyweight Impact Pack dependency with a focused implementation.
"""

import io
import json
import re
import struct
import torch
import numpy as np

import comfy.sample
import comfy.samplers
import comfy.sd
import comfy.utils
import comfy.model_management
import folder_paths
import latent_preview
import os

# Register the "ultralytics" model folder if not already known to ComfyUI.
# Models go into ComfyUI/models/ultralytics/ (e.g. face_yolov8m.pt).
_ultralytics_dir = os.path.join(folder_paths.models_dir, "ultralytics")
os.makedirs(_ultralytics_dir, exist_ok=True)
folder_paths.add_model_folder_path("ultralytics", _ultralytics_dir)


class MooshieFaceDetailer:
    """Detect faces with YOLOv8, crop each to guide_size, re-denoise, composite back."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": ("MODEL",),
                "vae": ("VAE",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "detector_model": (folder_paths.get_filename_list("ultralytics"),),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 100}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "denoise": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.0, "step": 0.05}),
                "guide_size": ("INT", {"default": 512, "min": 64, "max": 2048, "step": 64}),
                "bbox_threshold": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
                "bbox_padding": ("FLOAT", {"default": 1.5, "min": 1.0, "max": 4.0, "step": 0.1}),
                "feather": ("INT", {"default": 20, "min": 0, "max": 100}),
                "max_faces": ("INT", {"default": 0, "min": 0, "max": 100}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "mooshie"

    def process(
        self,
        image,
        model,
        vae,
        positive,
        negative,
        detector_model,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        denoise,
        guide_size,
        bbox_threshold,
        bbox_padding,
        feather,
        max_faces=0,
    ):
        from ultralytics import YOLO

        model_path = folder_paths.get_full_path("ultralytics", detector_model)
        if model_path is None:
            print(f"[MooshieFaceDetailer] Model not found: {detector_model}")
            return (image,)

        yolo = YOLO(model_path)

        B, H, W, C = image.shape
        result = image.clone()

        for b in range(B):
            frame = image[b].cpu().numpy()
            if np.isnan(frame).any():
                print(f"[MooshieFaceDetailer] WARNING: NaN values detected in input image batch {b}, replacing with zeros")
                frame = np.nan_to_num(frame, nan=0.0)
            img_np = (frame * 255).astype(np.uint8)

            detections = yolo(img_np, verbose=False)
            if not detections or len(detections[0].boxes) == 0:
                continue

            # Keep only boxes above threshold, then (when capped) refine the
            # most-confident faces first so max_faces drops the weakest detections.
            boxes = [box for box in detections[0].boxes if box.conf[0].item() >= bbox_threshold]
            if max_faces > 0 and len(boxes) > max_faces:
                boxes = sorted(boxes, key=lambda box: box.conf[0].item(), reverse=True)[:max_faces]

            for box in boxes:

                x1, y1, x2, y2 = box.xyxy[0].cpu().int().tolist()

                # Expand bbox with padding factor
                bw, bh = x2 - x1, y2 - y1
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                size = max(bw, bh) * bbox_padding

                cx1 = max(0, int(cx - size / 2))
                cy1 = max(0, int(cy - size / 2))
                cx2 = min(W, int(cx + size / 2))
                cy2 = min(H, int(cy + size / 2))

                crop_h = cy2 - cy1
                crop_w = cx2 - cx1
                if crop_h < 8 or crop_w < 8:
                    continue

                # Crop from current result
                crop = result[b : b + 1, cy1:cy2, cx1:cx2, :].clone()

                # Resize to guide_size (maintain aspect, round to 8 for VAE)
                scale = guide_size / max(crop_h, crop_w)
                new_h = max(8, round(crop_h * scale / 8) * 8)
                new_w = max(8, round(crop_w * scale / 8) * 8)

                resized = torch.nn.functional.interpolate(
                    crop.permute(0, 3, 1, 2),
                    size=(new_h, new_w),
                    mode="bilinear",
                    align_corners=False,
                ).permute(0, 2, 3, 1)

                # Create feathered mask at original crop resolution for pixel-space blending.
                # Use a generous feather proportional to the crop size for seamless edges.
                pixel_feather = max(feather, min(crop_h, crop_w) // 6)
                mask = self._make_feathered_mask(crop_h, crop_w, pixel_feather, image.device)

                # VAE encode
                latent = vae.encode(resized[:, :, :, :3])
                latent = comfy.sample.fix_empty_latent_channels(model, latent)

                # Sample — no noise_mask so the entire crop is denoised uniformly.
                # The pixel-space feathered blend handles the transition to the original.
                noise = comfy.sample.prepare_noise(latent, seed + b)
                callback = latent_preview.prepare_callback(model, steps)
                samples = comfy.sample.sample(
                    model,
                    noise,
                    steps,
                    cfg,
                    sampler_name,
                    scheduler,
                    positive,
                    negative,
                    latent,
                    denoise=denoise,
                    force_full_denoise=True,
                    callback=callback,
                    disable_pbar=False,
                    seed=seed + b,
                )

                # VAE decode
                decoded = vae.decode(samples)
                # Video VAEs (WanVAE etc.) return 5D [B,T,H,W,C] — flatten to 4D
                if decoded.ndim == 5:
                    decoded = decoded.reshape(
                        -1, decoded.shape[-3], decoded.shape[-2], decoded.shape[-1]
                    )

                # Resize back to original crop size
                back = torch.nn.functional.interpolate(
                    decoded.permute(0, 3, 1, 2),
                    size=(crop_h, crop_w),
                    mode="bilinear",
                    align_corners=False,
                ).permute(0, 2, 3, 1)

                # Blend mask is already at original crop resolution
                blend_mask = mask.unsqueeze(0).unsqueeze(-1)  # [1, H, W, 1]

                # Composite: denoised * mask + original * (1 - mask)
                original_crop = result[b : b + 1, cy1:cy2, cx1:cx2, :]
                blended = back * blend_mask + original_crop * (1 - blend_mask)
                result[b : b + 1, cy1:cy2, cx1:cx2, :] = blended.clamp(0, 1)

        return (result,)

    @staticmethod
    def _make_feathered_mask(h, w, feather, device):
        """Create a mask that's 1.0 in the center and smoothly fades to 0.0 at the edges.

        Uses a cosine falloff for each edge, then takes the product of all four
        edges.  This produces smooth, artifact-free transitions — much better
        than a linear ramp whose corners darken non-uniformly.
        """
        if feather <= 0:
            return torch.ones((h, w), dtype=torch.float32, device=device)

        f = min(feather, min(h, w) // 3)
        if f <= 0:
            return torch.ones((h, w), dtype=torch.float32, device=device)

        # Build 1-D cosine ramps: 0 at edge → 1 at f pixels in
        ramp = 0.5 * (1.0 - torch.cos(torch.linspace(0, torch.pi, f, device=device)))

        # Vertical mask: ramp on top/bottom, 1 in the middle
        v = torch.ones(h, dtype=torch.float32, device=device)
        v[:f] = ramp
        v[-f:] = ramp.flip(0)

        # Horizontal mask: ramp on left/right, 1 in the middle
        u = torch.ones(w, dtype=torch.float32, device=device)
        u[:f] = ramp[:min(f, w)]
        u[-f:] = ramp[:min(f, w)].flip(0)

        # Outer product gives smooth 2-D mask (corners blend naturally)
        mask = v.unsqueeze(1) * u.unsqueeze(0)
        return mask


class MooshieSegmentDetailer:
    """Detect a region by text (CLIPSeg) or YOLO model, re-denoise it with its
    own conditioning, and composite back using the (grown + blurred) detected
    mask — SwarmUI-style <segment:...> refinement."""

    CLIPSEG_REPO = "CIDAS/clipseg-rd64-refined"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "model": ("MODEL",),
                "vae": ("VAE",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "detection": ("STRING", {"default": ""}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 100}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "denoise": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 1.0, "step": 0.05}),
                "guide_size": ("INT", {"default": 512, "min": 64, "max": 2048, "step": 64}),
                "threshold": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
                "mask_grow": ("INT", {"default": 16, "min": 0, "max": 256}),
                "mask_blur": ("INT", {"default": 8, "min": 0, "max": 64}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "mooshie"

    def process(
        self,
        image,
        model,
        vae,
        positive,
        negative,
        detection,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        denoise,
        guide_size,
        threshold,
        mask_grow,
        mask_blur,
    ):
        detection = (detection or "").strip()
        if not detection:
            return (image,)

        B, H, W, C = image.shape
        result = image.clone()

        for b in range(B):
            frame = image[b].cpu().numpy()
            if np.isnan(frame).any():
                frame = np.nan_to_num(frame, nan=0.0)
            img_np = (frame * 255).astype(np.uint8)

            if detection.lower().startswith("yolo-"):
                mask = self._yolo_mask(detection[len("yolo-"):], img_np, H, W, threshold)
            else:
                mask = self._clipseg_mask(detection, img_np, H, W, threshold)

            if mask is None or (mask >= threshold).sum().item() < 16:
                print(f"[MooshieSegmentDetailer] No region found for '{detection}' (batch {b})")
                continue

            mask = mask.to(image.device)
            if mask_grow > 0:
                mask = torch.nn.functional.max_pool2d(
                    mask[None, None],
                    kernel_size=mask_grow * 2 + 1,
                    stride=1,
                    padding=mask_grow,
                )[0, 0]
            blurred = self._blur_mask(mask, mask_blur)

            ys, xs = torch.nonzero(blurred > 0.01, as_tuple=True)
            if ys.numel() == 0:
                print(f"[MooshieSegmentDetailer] Mask faded below blend threshold for '{detection}' (batch {b})")
                continue
            pad = 32
            cy1 = max(0, int(ys.min().item()) - pad)
            cy2 = min(H, int(ys.max().item()) + 1 + pad)
            cx1 = max(0, int(xs.min().item()) - pad)
            cx2 = min(W, int(xs.max().item()) + 1 + pad)
            crop_h, crop_w = cy2 - cy1, cx2 - cx1
            if crop_h < 8 or crop_w < 8:
                continue

            crop = result[b : b + 1, cy1:cy2, cx1:cx2, :].clone()

            scale = guide_size / max(crop_h, crop_w)
            new_h = max(8, round(crop_h * scale / 8) * 8)
            new_w = max(8, round(crop_w * scale / 8) * 8)
            resized = torch.nn.functional.interpolate(
                crop.permute(0, 3, 1, 2),
                size=(new_h, new_w),
                mode="bilinear",
                align_corners=False,
            ).permute(0, 2, 3, 1)

            latent = vae.encode(resized[:, :, :, :3])
            latent = comfy.sample.fix_empty_latent_channels(model, latent)

            noise = comfy.sample.prepare_noise(latent, seed + b)
            callback = latent_preview.prepare_callback(model, steps)
            samples = comfy.sample.sample(
                model,
                noise,
                steps,
                cfg,
                sampler_name,
                scheduler,
                positive,
                negative,
                latent,
                denoise=denoise,
                force_full_denoise=True,
                callback=callback,
                disable_pbar=False,
                seed=seed + b,
            )

            decoded = vae.decode(samples)
            if decoded.ndim == 5:
                decoded = decoded.reshape(
                    -1, decoded.shape[-3], decoded.shape[-2], decoded.shape[-1]
                )

            back = torch.nn.functional.interpolate(
                decoded.permute(0, 3, 1, 2),
                size=(crop_h, crop_w),
                mode="bilinear",
                align_corners=False,
            ).permute(0, 2, 3, 1)

            # Composite with the blurred detected mask so irregular shapes
            # (eyes, hands) blend cleanly — not a rectangular feather.
            blend = blurred[cy1:cy2, cx1:cx2].unsqueeze(0).unsqueeze(-1)
            original_crop = result[b : b + 1, cy1:cy2, cx1:cx2, :]
            result[b : b + 1, cy1:cy2, cx1:cx2, :] = (
                back * blend + original_crop * (1 - blend)
            ).clamp(0, 1)

        return (result,)

    @staticmethod
    def _parse_yolo_name(name):
        """'model.pt-2' -> ('model.pt', 2); 'model.pt' -> ('model.pt', None)."""
        m = re.match(r"^(.+\.(?:pt|onnx))-(\d+)$", name, re.IGNORECASE)
        if m:
            return m.group(1), int(m.group(2))
        return name, None

    def _yolo_mask(self, name, img_np, H, W, threshold):
        """Union mask [H, W] float 0/1 from YOLO detections, or None."""
        from ultralytics import YOLO

        model_name, match_index = self._parse_yolo_name(name.strip())
        model_path = folder_paths.get_full_path("ultralytics", model_name)
        if model_path is None:
            print(f"[MooshieSegmentDetailer] YOLO model not found: {model_name}")
            return None

        yolo = YOLO(model_path)
        detections = yolo(img_np, verbose=False)
        if not detections or len(detections[0].boxes) == 0:
            return None

        boxes = detections[0].boxes
        seg_masks = detections[0].masks.data if detections[0].masks is not None else None

        # Confidence-sorted indices above threshold; -N selects the Nth best match.
        order = sorted(range(len(boxes)), key=lambda i: boxes.conf[i].item(), reverse=True)
        order = [i for i in order if boxes.conf[i].item() >= threshold]
        if not order:
            return None
        if match_index is not None:
            if match_index < 1 or match_index > len(order):
                return None
            order = [order[match_index - 1]]

        mask = torch.zeros((H, W), dtype=torch.float32)
        for i in order:
            if seg_masks is not None:
                m = torch.nn.functional.interpolate(
                    seg_masks[i][None, None].float().cpu(),
                    size=(H, W),
                    mode="bilinear",
                    align_corners=False,
                )[0, 0]
                mask = torch.maximum(mask, (m > 0.5).float())
            else:
                x1, y1, x2, y2 = boxes.xyxy[i].cpu().int().tolist()
                mask[max(0, y1) : min(H, y2), max(0, x1) : min(W, x2)] = 1.0
        return mask

    def _clipseg_mask(self, text, img_np, H, W, threshold):
        """Binary mask [H, W] from CLIPSeg text detection.

        Weights cache under models/clipseg/ (auto-downloaded on first use) and
        are released after each run — no persistent VRAM/RAM residency.
        """
        from transformers import CLIPSegProcessor, CLIPSegForImageSegmentation
        from PIL import Image as PILImage

        cache_dir = os.path.join(folder_paths.models_dir, "clipseg")
        os.makedirs(cache_dir, exist_ok=True)

        processor = CLIPSegProcessor.from_pretrained(self.CLIPSEG_REPO, cache_dir=cache_dir)
        seg_model = CLIPSegForImageSegmentation.from_pretrained(
            self.CLIPSEG_REPO, cache_dir=cache_dir
        )
        try:
            pil = PILImage.fromarray(img_np)
            inputs = processor(text=[text], images=[pil], return_tensors="pt")
            with torch.no_grad():
                logits = seg_model(**inputs).logits
            heat = torch.sigmoid(logits.float())
            if heat.ndim == 3:
                heat = heat[0]
            mask = torch.nn.functional.interpolate(
                heat[None, None], size=(H, W), mode="bilinear", align_corners=False
            )[0, 0]
            max_heat = mask.max().item()
            mean_heat = mask.mean().item()
            pixels_above = int((mask >= threshold).sum().item())
            print(
                f"[MooshieSegmentDetailer] CLIPSeg '{text}': "
                f"max={max_heat:.3f} mean={mean_heat:.3f} threshold={threshold:.3f} "
                f"pixels_above={pixels_above}"
            )
            # Return soft sigmoid values [0,1] — the threshold gates existence only;
            # soft values let both eyes (or any bilateral feature) blend proportionally
            # to confidence rather than the brighter one winning exclusively.
            return mask
        finally:
            del seg_model, processor

    @staticmethod
    def _blur_mask(mask, radius):
        """Approximate gaussian blur with 3 box blurs (replicate-padded avg_pool)."""
        if radius <= 0:
            return mask.clamp(0, 1)
        k = radius * 2 + 1
        m = mask[None, None]
        for _ in range(3):
            m = torch.nn.functional.avg_pool2d(
                torch.nn.functional.pad(m, (radius, radius, radius, radius), mode="replicate"),
                kernel_size=k,
                stride=1,
            )
        return m[0, 0].clamp(0, 1)


class MooshieSaveImage:
    """Output node that keeps images in RAM and sends them over WebSocket.

    Inspired by SwarmUI's approach — avoids the disk round-trip that ComfyUI's
    built-in SaveImage performs (write → re-read → HTTP serve → delete).
    Benefits: no drive I/O, lower latency, no data-leak from temp files on disk.
    """

    MOOSHIE_EVENT_TYPE = 100  # custom binary WS event type
    MOOSHIE_CONTROLNET_PREPROCESSOR_EVENT_TYPE = 101
    # Format sub-types packed into the first 4 bytes after the event type header.
    # The Rust WebSocket handler reads this to tell the frontend what it received.
    FMT_PNG_8 = 1        # 8-bit PNG  (uint8,  standard)
    FMT_PNG_16 = 2       # 16-bit PNG (uint16, higher precision for post-processing)
    FMT_RAW_RGBA8 = 3    # 8-bit RGBA raw pixels  + 8-byte geometry header
    FMT_RAW_RGBA16 = 4   # 16-bit RGBA raw pixels + 8-byte geometry header (native endian)
    FMT_RAW_RGBA8_WEBP = 5  # 8-bit RGBA raw pixels, encoded to lossless WebP in Rust

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
            },
            "optional": {
                "bit_depth": (["8bit", "16bit"], {"default": "8bit"}),
                "output_format": (["png", "jxl_raw", "webp_raw"], {"default": "png"}),
                "output_role": (["final", "controlnet_preprocessor"], {"default": "final"}),
            },
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save_images"
    CATEGORY = "mooshie"
    DESCRIPTION = (
        "Sends images directly over WebSocket instead of writing to disk. "
        "Supports 8/16-bit PNG (default) and raw RGBA (encoded to JPEG XL "
        "in the Tauri backend when output_format=jxl_raw, or lossless WebP "
        "when output_format=webp_raw)."
    )

    def save_images(self, images, bit_depth="8bit", output_format="png", output_role="final"):
        from server import PromptServer

        server = PromptServer.instance
        # WebP is 8-bit only (the container has no 16-bit sample format), so the
        # raw payload is always packed at 8 bits regardless of the bit_depth input.
        want_webp = (output_format == "webp_raw")
        want_raw = want_webp or (output_format == "jxl_raw")
        event_type = self.MOOSHIE_CONTROLNET_PREPROCESSOR_EVENT_TYPE if output_role == "controlnet_preprocessor" else self.MOOSHIE_EVENT_TYPE

        for i in range(images.shape[0]):
            frame = images[i].cpu().numpy()
            if np.isnan(frame).any():
                print(f"[MooshieSaveImage] WARNING: NaN values in output image {i} — VAE may have failed (VRAM pressure?). Replacing NaN with black.")
                frame = np.nan_to_num(frame, nan=0.0)
                images[i] = torch.from_numpy(frame).to(images.device)

            # Detect all-black output — common after VRAM corruption from rapid
            # interrupts on Blackwell GPUs with cudaMallocAsync.
            if frame.max() < 1e-6:
                print(f"[MooshieSaveImage] WARNING: Output image {i} is all-black (max pixel={frame.max():.2e}). "
                      "This usually means VRAM was corrupted by rapid generation interrupts. "
                      "Try generating again — the models will be reloaded cleanly.")

            if want_webp:
                _, image_bytes = self._encode_raw(frame, "8bit")
                fmt_tag = self.FMT_RAW_RGBA8_WEBP
            elif want_raw:
                fmt_tag, image_bytes = self._encode_raw(frame, bit_depth)
            elif bit_depth == "16bit":
                fmt_tag = self.FMT_PNG_16
                image_bytes = self._encode_16bit(images[i])
            else:
                fmt_tag = self.FMT_PNG_8
                image_bytes = self._encode_png_8bit(frame)

            # Payload: format_tag (4 bytes BE) + image data
            payload = struct.pack(">I", fmt_tag) + image_bytes
            server.send_sync(event_type, payload)

        return {"ui": {"images": []}}

    @staticmethod
    def _encode_png_8bit(frame):
        from PIL import Image

        img_np = (255.0 * frame).clip(0, 255).astype(np.uint8)
        # Output RGBA (alpha=255) so the PNG has an alpha channel.
        h, w, _ = img_np.shape
        rgba = np.full((h, w, 4), 255, dtype=np.uint8)
        rgba[:, :, :3] = img_np[:, :, :3]
        img = Image.fromarray(rgba, "RGBA")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    @classmethod
    def _encode_raw(cls, frame, bit_depth):
        """Pack raw RGBA pixels (no compression) for JXL encoding in Rust.

        Header (8 bytes, big-endian fixed layout):
            width   u16
            height  u16
            channels u8   (always 4 — RGBA)
            depth    u8   (8 or 16)
            reserved u16  (zero)

        Payload: tightly packed RGBA bytes, row-major. 16-bit samples are
        native-endian u16 pairs (matches `zune-jpegxl`'s expected layout).
        """
        h, w, _ = frame.shape
        if w > 0xFFFF or h > 0xFFFF:
            raise ValueError(
                f"MooshieSaveImage raw path only supports <=65535 px per side, got {w}x{h}"
            )

        if bit_depth == "16bit":
            fmt_tag = cls.FMT_RAW_RGBA16
            rgb_u16 = (65535.0 * frame).clip(0, 65535).astype(np.uint16)
            rgba = np.full((h, w, 4), 0xFFFF, dtype=np.uint16)
            rgba[:, :, :3] = rgb_u16[:, :, :3]
            depth = 16
            pixels = rgba.tobytes()  # native endian, matches zune-jpegxl 16-bit input
        else:
            fmt_tag = cls.FMT_RAW_RGBA8
            rgb_u8 = (255.0 * frame).clip(0, 255).astype(np.uint8)
            rgba = np.full((h, w, 4), 255, dtype=np.uint8)
            rgba[:, :, :3] = rgb_u8[:, :, :3]
            depth = 8
            pixels = rgba.tobytes()

        header = struct.pack(">HHBBH", w, h, 4, depth, 0)
        return fmt_tag, header + pixels

    @staticmethod
    def _encode_16bit(image_tensor):
        """Encode a float32 image tensor as a 16-bit RGB PNG.

        Uses OpenCV when available (fast, correct colour order).
        Falls back to a pure-Python PNG writer (zlib + struct) otherwise.
        """
        arr = np.nan_to_num(image_tensor.cpu().numpy(), nan=0.0)
        arr = (65535.0 * arr).clip(0, 65535).astype(np.uint16)

        try:
            import cv2
            # OpenCV expects BGR; our tensor is RGB
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
            ok, encoded = cv2.imencode(".png", bgr)
            if ok and encoded is not None:
                return encoded.tobytes()
        except ImportError:
            pass

        # Pure-Python fallback: write a valid 16-bit RGB PNG using zlib.
        # PIL cannot write 16-bit RGB, so we build the PNG manually.
        import zlib

        h, w, _ = arr.shape
        # Convert to big-endian (PNG stores 16-bit values as BE)
        arr_be = arr.astype(">u2")

        # Build raw image data: each row = filter_byte(0) + 6 bytes per pixel
        raw_rows = []
        for y in range(h):
            raw_rows.append(b"\x00")  # filter: none
            raw_rows.append(arr_be[y].tobytes())
        raw_data = b"".join(raw_rows)
        compressed = zlib.compress(raw_data)

        def _png_chunk(chunk_type, data):
            chunk = chunk_type + data
            crc = zlib.crc32(chunk) & 0xFFFFFFFF
            return struct.pack(">I", len(data)) + chunk + struct.pack(">I", crc)

        buf = io.BytesIO()
        buf.write(b"\x89PNG\r\n\x1a\n")  # PNG signature
        # IHDR: width, height, bit_depth=16, color_type=2 (RGB)
        ihdr_data = struct.pack(">IIBBBBB", w, h, 16, 2, 0, 0, 0)
        buf.write(_png_chunk(b"IHDR", ihdr_data))
        buf.write(_png_chunk(b"IDAT", compressed))
        buf.write(_png_chunk(b"IEND", b""))
        return buf.getvalue()

    @classmethod
    def IS_CHANGED(cls, images, bit_depth="8bit", output_format="png", output_role="final"):
        # Always re-execute — output nodes should never be cached.
        return float("nan")


MOOSHIE_VIDEO_EVENT_TYPE = 102


class MooshieSaveVideo:
    """Save a VIDEO to ComfyUI's output directory and notify the Mooshie
    backend over the client WebSocket (binary event 102) with absolute file
    paths, so Rust can move the mp4 into the gallery without shuttling the
    encoded bytes through the socket. Also writes a poster WebP of frame 0
    next to the mp4 for thumbnail serving.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO",),
            },
            "optional": {
                "filename_prefix": ("STRING", {"default": "mooshie_video"}),
                "draft_id": ("STRING", {"default": ""}),
                # SwarmUI-shaped JSON built by templates/video.rs. Optional so a
                # workflow from an older MooshieUI still validates.
                "metadata_json": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "save_video"
    CATEGORY = "mooshie"
    DESCRIPTION = "Saves the video as mp4 with a poster frame and notifies MooshieUI over WebSocket."

    def save_video(self, video, filename_prefix="mooshie_video", metadata_json="", draft_id=""):
        from PIL import Image
        from comfy_api.latest import Types
        from server import PromptServer

        # A raised exception in a node kills the whole prompt, so every step that
        # touches metadata is guarded and degrades to saving without it.
        params = None
        if metadata_json:
            try:
                parsed = json.loads(metadata_json)
                if isinstance(parsed, dict):
                    params = parsed
            except Exception:
                params = None

        width, height = video.get_dimensions()
        full_output_folder, filename, counter, _subfolder, _prefix = (
            folder_paths.get_save_image_path(
                filename_prefix, folder_paths.get_output_directory(), width, height
            )
        )
        video_file = f"{filename}_{counter:05}_.mp4"
        video_path = os.path.join(full_output_folder, video_file)
        # `metadata` values are json.dumps'd by save_to, so this has to be the
        # parsed dict: handing it the original string would double-encode it.
        # The key is `comment` because that is the one mdta key a remux without
        # `-movflags use_metadata_tags` still carries.
        try:
            if params is not None:
                video.save_to(
                    video_path,
                    format=Types.VideoContainer("mp4"),
                    codec="auto",
                    metadata={"comment": params},
                )
            else:
                video.save_to(
                    video_path, format=Types.VideoContainer("mp4"), codec="auto"
                )
        except Exception:
            video.save_to(video_path, format=Types.VideoContainer("mp4"), codec="auto")

        components = video.get_components()
        frames = components.images
        frame_count = int(frames.shape[0])
        fps = float(components.frame_rate)

        poster_path = os.path.splitext(video_path)[0] + "_poster.webp"
        frame0 = (255.0 * frames[0].cpu().numpy()).clip(0, 255).astype(np.uint8)
        poster = Image.fromarray(frame0[:, :, :3], "RGB")
        poster_kwargs = {"format": "WEBP", "quality": 90}
        if params is not None:
            try:
                # UserComment (0x9286) in the Exif sub-IFD (0x8769), the same
                # carrier the Rust WebP writer uses for still images.
                exif = Image.Exif()
                text = json.dumps(params, ensure_ascii=False)
                exif[0x8769] = {
                    0x9286: b"UNICODE\x00" + text.encode("utf-16-be")
                }
                poster_kwargs["exif"] = exif.tobytes()
            except Exception:
                pass
        try:
            poster.save(poster_path, **poster_kwargs)
        except Exception:
            # Same degradation as the mp4 path above: drop the metadata and
            # save the poster anyway rather than killing the prompt.
            poster_kwargs.pop("exif", None)
            poster.save(poster_path, **poster_kwargs)

        from .h3_drafts import mark_complete
        mark_complete(draft_id)
        payload = json.dumps(
            {
                "video_path": os.path.abspath(video_path),
                "poster_path": os.path.abspath(poster_path),
                "fps": fps,
                "frame_count": frame_count,
                "width": int(width),
                "height": int(height),
                "draft_id": draft_id,
                "filename": video_file,
                "subfolder": _subfolder,
                "poster_filename": os.path.basename(poster_path),
            }
        ).encode("utf-8")
        PromptServer.instance.send_sync(MOOSHIE_VIDEO_EVENT_TYPE, payload)
        return {"ui": {"images": []}}

    @classmethod
    def IS_CHANGED(cls, video, filename_prefix="mooshie_video", metadata_json="", draft_id=""):
        # Always re-execute — output nodes should never be cached. Without this,
        # a regenerate with identical inputs (e.g. a pinned seed) cache-hits the
        # whole upstream chain: save_video() never runs, no new file or event is
        # produced, and the UI is left showing the previous video.
        return float("nan")


_MODEL_EXTENSIONS = (".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".bin")


def _validate_model_path(node_name, path):
    """Resolve and sanity-check an absolute model path supplied as a STRING input.

    The stock loaders take a combo of filenames from one folder, so a model that
    physically sits in the "wrong" folder (a unet in models/checkpoints/, say) is
    rejected at /prompt validation time. MooshieUI detects the real model kind and
    passes an absolute path instead; the Tauri backend has already resolved it
    against ComfyUI's model roots, so here we only guard against typos and
    non-model files.
    """
    if not path or not path.strip():
        raise ValueError(f"{node_name}: empty model path")
    resolved = os.path.abspath(os.path.expanduser(path.strip()))
    if not os.path.isfile(resolved):
        raise ValueError(f"{node_name}: model file not found: {resolved}")
    if not resolved.lower().endswith(_MODEL_EXTENSIONS):
        raise ValueError(f"{node_name}: not a recognized model file: {resolved}")
    return resolved


class MooshieCheckpointLoaderPath:
    """CheckpointLoaderSimple that takes an absolute path instead of a folder combo."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ckpt_path": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    FUNCTION = "load_checkpoint"
    CATEGORY = "mooshie"
    DESCRIPTION = (
        "Loads a full checkpoint (baked CLIP + VAE) from an absolute path, so a "
        "checkpoint stored outside models/checkpoints/ still loads."
    )

    def load_checkpoint(self, ckpt_path):
        path = _validate_model_path("MooshieCheckpointLoaderPath", ckpt_path)
        print(f"[MooshieCheckpointLoaderPath] loading {path}")
        out = comfy.sd.load_checkpoint_guess_config(
            path,
            output_vae=True,
            output_clip=True,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
        return out[:3]


class MooshieDiffusionLoaderPath:
    """UNETLoader that takes an absolute path instead of a folder combo."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "unet_path": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "weight_dtype": (
                    ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
                    {"default": "default"},
                ),
            },
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet"
    CATEGORY = "mooshie"
    DESCRIPTION = (
        "Loads a diffusion model (unet/DiT only, no baked CLIP or VAE) from an "
        "absolute path, so a split-file model stored outside "
        "models/diffusion_models/ still loads."
    )

    def load_unet(self, unet_path, weight_dtype="default"):
        if weight_dtype.startswith("fp8") and comfy.model_management.get_torch_device().type == "mps":
            raise ValueError("Explicit FP8 precision is not supported on Apple Metal. Use default precision.")
        path = _validate_model_path("MooshieDiffusionLoaderPath", unet_path)
        # Mirrors core UNETLoader's dtype handling.
        model_options = {}
        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2

        print(f"[MooshieDiffusionLoaderPath] loading {path} (weight_dtype={weight_dtype})")
        model = comfy.sd.load_diffusion_model(path, model_options=model_options)
        return (model,)


class MooshieLoadVideoPath:
    """Decode an mp4 from an absolute path into frames plus audio.

    ComfyUI's stock loaders read a filename inside the input directory, but the
    gallery lives elsewhere and post-hoc interpolation has to re-open a clip
    that was already saved. The Rust side proves the path sits inside the
    caller's own gallery before it ever reaches here.

    `output_fps` is returned rather than assumed so the caller never has to
    guess the source rate: interpolating an already-interpolated 48 fps clip
    yields 96, not 48.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path": ("STRING", {"default": "", "multiline": False}),
                "fps_multiplier": ("INT", {"default": 2, "min": 1, "max": 8}),
            }
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT")
    RETURN_NAMES = ("images", "audio", "output_fps")
    FUNCTION = "load_video"
    CATEGORY = "mooshie"
    DESCRIPTION = (
        "Loads an mp4 from an absolute path as frames plus audio, and reports "
        "the playback rate the interpolated result should use."
    )

    def load_video(self, video_path, fps_multiplier=2):
        # Imported lazily so a ComfyUI install without PyAV can still load the
        # rest of this module.
        import av

        path = (video_path or "").strip()
        if not path:
            raise ValueError("MooshieLoadVideoPath: empty video path")
        resolved = os.path.abspath(os.path.expanduser(path))
        if not os.path.isfile(resolved):
            raise ValueError(f"MooshieLoadVideoPath: file not found: {resolved}")

        frames = []
        source_fps = 24.0
        with av.open(resolved) as container:
            if not container.streams.video:
                raise ValueError(f"MooshieLoadVideoPath: no video stream in {resolved}")
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            if stream.average_rate:
                source_fps = float(stream.average_rate)
            for frame in container.decode(stream):
                frames.append(frame.to_ndarray(format="rgb24"))

        if not frames:
            raise ValueError(f"MooshieLoadVideoPath: decoded zero frames from {resolved}")

        images = torch.from_numpy(np.stack(frames).astype(np.float32) / 255.0)
        audio = self._load_audio(resolved, len(frames) / source_fps)
        print(
            f"[MooshieLoadVideoPath] {len(frames)} frames at {source_fps:.3f} fps "
            f"from {resolved}"
        )
        return (images, audio, float(source_fps * fps_multiplier))

    @staticmethod
    def _load_audio(path, duration_seconds):
        """Decode the audio track, or synthesise silence of the same length.

        Returning silence rather than None lets the graph wire `audio`
        unconditionally: CreateVideo accepts a silent track, but a missing
        required link fails prompt validation outright.
        """
        import av

        sample_rate = 44100
        chunks = []
        try:
            with av.open(path) as container:
                if container.streams.audio:
                    stream = container.streams.audio[0]
                    sample_rate = int(stream.rate or sample_rate)
                    resampler = av.audio.resampler.AudioResampler(
                        format="fltp", layout="stereo", rate=sample_rate
                    )
                    for frame in container.decode(stream):
                        for resampled in resampler.resample(frame):
                            chunks.append(resampled.to_ndarray())
                    for resampled in resampler.resample(None):
                        chunks.append(resampled.to_ndarray())
        except Exception as exc:
            # A broken audio track must not lose the user's interpolated video.
            print(f"[MooshieLoadVideoPath] audio decode failed ({exc}), using silence")
            chunks = []

        if chunks:
            waveform = torch.from_numpy(np.concatenate(chunks, axis=1)).unsqueeze(0)
        else:
            samples = max(1, int(round(duration_seconds * sample_rate)))
            waveform = torch.zeros((1, 2, samples), dtype=torch.float32)
        return {"waveform": waveform, "sample_rate": sample_rate}

    @classmethod
    def IS_CHANGED(cls, video_path, fps_multiplier=2):
        # Re-run when the file on disk changes, not just when the path string
        # does, so re-interpolating an overwritten clip is not served stale.
        try:
            return os.path.getmtime(os.path.abspath(os.path.expanduser((video_path or "").strip())))
        except OSError:
            return float("nan")


class MooshieFaceDetect:
    """Detect faces and report the boxes as JSON. No sampling, no model load.

    The NovelAI face detailer keeps detection local but sends each crop to
    NovelAI, so the crop, the repaint and the composite all happen in Rust.
    All ComfyUI is asked for here is where the faces are, which is why this
    node loads neither a checkpoint nor a VAE.

    The result reaches Rust through the history endpoint as
    `outputs[<node>]["text"][0]`, a JSON object of the form
    `{"width": W, "height": H, "boxes": [{"x1": .., "y1": .., "x2": .., "y2":
    .., "confidence": ..}, ...]}` with boxes sorted most-confident first.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "detector_model": (folder_paths.get_filename_list("ultralytics"),),
                "bbox_threshold": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
                "max_faces": ("INT", {"default": 0, "min": 0, "max": 100}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "detect"
    CATEGORY = "mooshie"
    OUTPUT_NODE = True

    def detect(self, image, detector_model, bbox_threshold, max_faces=0):
        from ultralytics import YOLO

        B, H, W, C = image.shape
        payload = {"width": int(W), "height": int(H), "boxes": []}

        model_path = folder_paths.get_full_path("ultralytics", detector_model)
        if model_path is None:
            print(f"[MooshieFaceDetect] Model not found: {detector_model}")
            payload["error"] = f"detector model not found: {detector_model}"
            return {"ui": {"text": [json.dumps(payload)]}}

        yolo = YOLO(model_path)

        # Only the first frame is inspected: the caller runs one image at a
        # time, and a batch would have no way to say which boxes belong to
        # which frame in a single flat list.
        frame = image[0].cpu().numpy()
        if np.isnan(frame).any():
            print("[MooshieFaceDetect] WARNING: NaN values in input image, replacing with zeros")
            frame = np.nan_to_num(frame, nan=0.0)
        img_np = (frame * 255).astype(np.uint8)

        detections = yolo(img_np, verbose=False)
        if detections and len(detections[0].boxes) > 0:
            boxes = [box for box in detections[0].boxes if box.conf[0].item() >= bbox_threshold]
            # Sorted here rather than in Rust so max_faces means the same
            # "strongest detections win" it does in MooshieFaceDetailer.
            boxes = sorted(boxes, key=lambda box: box.conf[0].item(), reverse=True)
            if max_faces > 0:
                boxes = boxes[:max_faces]
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().int().tolist()
                payload["boxes"].append(
                    {
                        "x1": int(x1),
                        "y1": int(y1),
                        "x2": int(x2),
                        "y2": int(y2),
                        "confidence": float(box.conf[0].item()),
                    }
                )

        return {"ui": {"text": [json.dumps(payload)]}}


class MooshieSigmaTail:
    """Schedule for the remaining steps of a paused run.

    A paused run stopped at `sigmas[at_step]` of its original schedule. This
    returns `steps + 1` sigmas that start exactly there and end at zero,
    spaced the way `scheduler` would space them, so the resumed stage can use
    a different scheduler or a different number of remaining steps without
    the noise level it starts from being wrong.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "sigmas": ("SIGMAS",),
                "at_step": ("INT", {"default": 0, "min": 0, "max": 10000}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "steps": ("INT", {"default": 10, "min": 1, "max": 10000}),
            }
        }

    RETURN_TYPES = ("SIGMAS",)
    FUNCTION = "build"
    CATEGORY = "mooshie/pause"

    def build(self, model, sigmas, at_step, scheduler, steps):
        sigmas = sigmas.detach().float().cpu()
        at_step = max(0, min(int(at_step), sigmas.shape[0] - 1))
        sigma_start = sigmas[at_step].item()
        if sigma_start <= 0.0:
            print("[MooshieSigmaTail] paused schedule is already at zero; nothing left to sample")
            return (torch.zeros(2),)

        # A fine schedule under the requested scheduler, cut where it first
        # falls to the paused noise level, then resampled to the requested
        # step count. Works for every scheduler ComfyUI knows, including
        # timestep-spaced ones (normal, simple, sgm_uniform) that have no
        # closed form between two arbitrary sigmas.
        model_sampling = model.get_model_object("model_sampling")
        fine = comfy.samplers.calculate_sigmas(model_sampling, scheduler, 1000).float().cpu()
        below = (fine <= sigma_start).nonzero()
        first = int(below[0].item()) if below.numel() > 0 else fine.shape[0] - 1
        tail = fine[first:]
        if tail.shape[0] < 2:
            tail = torch.tensor([sigma_start, 0.0])

        positions = torch.linspace(0.0, float(tail.shape[0] - 1), int(steps) + 1)
        lower = positions.floor().long().clamp(0, tail.shape[0] - 1)
        upper = (lower + 1).clamp(0, tail.shape[0] - 1)
        frac = positions - lower.float()
        out = tail[lower] * (1.0 - frac) + tail[upper] * frac
        out[0] = sigma_start
        out[-1] = 0.0
        return (out,)


class MooshieResumeEdit:
    """Paint a correction into a paused latent at the paused noise level.

    `edited_latent` is the VAE encoding of the paused preview with the user's
    changes painted on it. It is noised to `sigmas[at_step]` with the model's
    own noise schedule, then blended into `paused_latent` where `mask` is
    white. The resumed sampler carries on from the blend as if the edit had
    been there from the start. Without a mask the whole latent is replaced.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "sigmas": ("SIGMAS",),
                "at_step": ("INT", {"default": 0, "min": 0, "max": 10000}),
                "edited_latent": ("LATENT",),
                "paused_latent": ("LATENT",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "blend"
    CATEGORY = "mooshie/pause"

    def blend(self, model, sigmas, at_step, edited_latent, paused_latent, seed, mask=None):
        sigmas = sigmas.detach().float().cpu()
        at_step = max(0, min(int(at_step), sigmas.shape[0] - 1))
        sigma = sigmas[at_step]

        model_sampling = model.get_model_object("model_sampling")
        process_in = model.model.process_latent_in
        process_out = model.model.process_latent_out

        edited = edited_latent["samples"].detach().float().cpu()
        paused = paused_latent["samples"].detach().float().cpu()
        if edited.ndim == 4 and edited.shape[-2:] != paused.shape[-2:]:
            print(
                "[MooshieResumeEdit] edited latent %s does not match paused latent %s; resizing"
                % (tuple(edited.shape), tuple(paused.shape))
            )
            edited = torch.nn.functional.interpolate(
                edited, size=paused.shape[-2:], mode="bilinear"
            )
        if edited.shape[0] != paused.shape[0]:
            edited = edited[:1].expand(paused.shape[0], *edited.shape[1:]).contiguous()

        # Noise the edit the same way the sampler noised the first stage, in
        # the model's latent space, so eps, v-prediction and flow-matching
        # models all land at the paused noise level.
        z_edit = process_in(edited)
        z_paused = process_in(paused)
        noise = comfy.sample.prepare_noise(z_edit, seed).float().cpu()
        z_noisy = model_sampling.noise_scaling(sigma.reshape([1] * z_edit.ndim), noise, z_edit)
        # Sampler outputs undo their ending noise scale before returning a
        # LATENT. Match that representation: resume applies the start scale
        # again even with add_noise disabled. Flow models would otherwise
        # multiply the edited region by (1 - sigma) a second time.
        z_noisy = model_sampling.inverse_noise_scaling(sigma, z_noisy)

        if mask is None:
            blended = z_noisy
        else:
            m = mask.detach().float().cpu()
            m = m.reshape((-1, 1) + tuple(m.shape[-2:]))
            m = torch.nn.functional.interpolate(m, size=z_paused.shape[-2:], mode="bilinear")
            if m.shape[0] != z_paused.shape[0]:
                m = m[:1].expand(z_paused.shape[0], *m.shape[1:])
            if z_paused.ndim == 5:
                m = m.unsqueeze(2)
            blended = z_noisy * m + z_paused * (1.0 - m)

        out = paused_latent.copy()
        out["samples"] = process_out(blended)
        out.pop("noise_mask", None)
        return (out,)


class MooshieYuE2Plan:
    """Native YuE2 planning with an explicit end-token/budget receipt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip": ("CLIP",), "style": ("STRING", {"multiline": True}),
            "lyrics": ("STRING", {"multiline": True}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            "mode": (["full", "melody"],),
            "max_abc_tokens": ("INT", {"default": 8192, "min": 1, "max": 20000}),
        }}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("abc", "receipt")
    FUNCTION = "plan"
    CATEGORY = "mooshie/music"

    def plan(self, clip, style, lyrics, seed, mode, max_abc_tokens):
        tokens = clip.tokenize(style, lyrics=lyrics, cot=mode, seed=seed, max_tokens=max_abc_tokens)
        ids = clip.generate(tokens, max_length=max_abc_tokens, temperature=0.7,
                            top_p=0.9, top_k=30, repetition_penalty=1.005, seed=seed)
        # The supported native generator omits ABC_END from returned ids and
        # returns immediately on it. Exactly max_length ids therefore means
        # that every iteration produced a non-end token, including the last.
        # This is the token stopping contract, not an estimate from score/audio length.
        if not isinstance(ids, list) or len(ids) > max_abc_tokens:
            raise RuntimeError("Unsupported YuE2 planner token result; update the music adapter.")
        receipt = {"adapter": "mooshie-yue2-1", "abc_truncated": len(ids) == max_abc_tokens,
                   "abc_tokens": len(ids), "max_abc_tokens": max_abc_tokens}
        return clip.decode(ids), json.dumps(receipt)


class MooshieYuE2Music:
    """Native semantic generation with guidance and a small, serializable receipt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip": ("CLIP",), "style": ("STRING", {"multiline": True}),
            "lyrics": ("STRING", {"multiline": True}), "abc": ("STRING", {"multiline": True}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            "mode": (["full", "melody"],),
            "max_duration": ("FLOAT", {"default": 120.0, "min": 1.0, "max": 360.0}),
            "temperature": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0}),
            "top_p": ("FLOAT", {"default": 0.95, "min": 0.01, "max": 1.0}),
            "top_k": ("INT", {"default": 100, "min": 1, "max": 32768}),
            "repetition_penalty": ("FLOAT", {"default": 1.2, "min": 0.01, "max": 10.0}),
            "cfg_scale": ("FLOAT", {"default": -1.0, "min": -1.0, "max": 20.0}),
        }}

    RETURN_TYPES = ("CONDITIONING", "FLOAT", "STRING")
    RETURN_NAMES = ("conditioning", "seconds", "receipt")
    FUNCTION = "generate"
    CATEGORY = "mooshie/music"

    def generate(self, clip, style, lyrics, abc, seed, mode, max_duration,
                 temperature, top_p, top_k, repetition_penalty, cfg_scale):
        from comfy.text_encoders.yue2 import FRAMES_PER_SECOND
        if not abc.strip():
            mode = "off"
        if cfg_scale == -1:
            cfg_scale = 1.01 if mode == "off" else 1.0
        if not 0 <= cfg_scale <= 20:
            raise ValueError("Semantic guidance must be automatic (-1), or 0–20.")
        tokens = clip.tokenize(style, lyrics=lyrics, cot=mode, abc=abc, seed=seed,
                               max_tokens=max(1, round(max_duration * FRAMES_PER_SECOND)),
                               temperature=temperature, top_p=top_p, top_k=top_k,
                               repetition_penalty=repetition_penalty, cfg_scale=cfg_scale)
        conditioning = clip.encode_from_tokens_scheduled(tokens)
        metadata = conditioning[0][1]
        seconds = metadata["yue2_frames"] / FRAMES_PER_SECOND
        truncated = metadata.get("yue2_truncated")
        receipt = {"adapter": "mooshie-yue2-1", "semantic_truncated": truncated if isinstance(truncated, bool) else None,
                   "semantic_frames": metadata["yue2_frames"], "generated_seconds": seconds,
                   "cfg_scale": cfg_scale, "mode": mode}
        return conditioning, seconds, json.dumps(receipt)


class MooshieMusicLoadAudio:
    """Load one app-owned source recording and remove that temporary upload."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"audio": ("STRING",)}}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "load"
    CATEGORY = "mooshie/music"

    @classmethod
    def IS_CHANGED(cls, audio):
        return float("nan")

    def load(self, audio):
        import av
        from comfy.model_management import throw_exception_if_processing_interrupted
        from pathlib import Path
        import time
        pattern = r"mooshie_cover_[0-9a-f-]{36}\.(wav|mp3|flac|m4a|ogg|opus|aiff|aif)"
        if not re.fullmatch(pattern, audio):
            raise ValueError("Invalid temporary cover recording name.")
        root = Path(folder_paths.get_input_directory()).resolve()
        source = root / audio
        if source.is_symlink() or source.resolve().parent != root:
            raise ValueError("Cover recording must be a regular file in the input folder.")
        # Cancelled queues can leave an upload unconsumed. Only this namespaced,
        # bounded-lifetime class of files is eligible for later cleanup.
        for old in root.glob("mooshie_cover_*"):
            try:
                if re.fullmatch(pattern, old.name) and not old.is_symlink() and time.time() - old.stat().st_mtime > 86400:
                    old.unlink()
            except OSError:
                pass
        try:
            if not source.is_file() or source.stat().st_size > 64 * 1024 * 1024:
                raise ValueError("Missing cover recording or source exceeds 64 MiB.")
            # Decode incrementally with a hard duration bound. Container metadata
            # can be absent or wrong; never accumulate hours from a small MP3.
            sample_rate = 44100
            frames, samples = [], 0
            with av.open(str(source)) as container:
                if not container.streams.audio:
                    raise ValueError("The recording has no audio stream.")
                stream = container.streams.audio[0]
                resampler = av.AudioResampler(format="fltp", layout="stereo", rate=sample_rate)
                def append(frame):
                    nonlocal samples
                    samples += frame.samples
                    if samples > 360 * sample_rate:
                        raise ValueError("Cover source exceeds 360 seconds. Trim it before transcription.")
                    frames.append(torch.from_numpy(frame.to_ndarray()))
                for frame in container.decode(streams=stream.index):
                    throw_exception_if_processing_interrupted()
                    for output in resampler.resample(frame):
                        append(output)
                for output in resampler.resample(None):
                    append(output)
            if not frames:
                raise ValueError("No audio frames decoded.")
            waveform = torch.cat(frames, dim=1)
            return ({"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},)
        finally:
            try:
                source.unlink(missing_ok=True)
            except OSError:
                pass


# Inpainting workspace nodes. Kept self-contained for CPU regression tests.
def _inpaint_options(settings):
    defaults = dict(resize_mode="resize", mask_blur=4, invert_mask=False,
                    masked_content="original", area="whole", padding=32,
                    context_padding_x=None, context_padding_y=None,
                    context_shape="bounds", context_min_size=0,
                    # Older saved workflows did not request aspect fitting.
                    # The current UI sends this explicitly for each layer.
                    preserve_context_aspect=False, soft=False,
                    schedule_bias=1, preservation=.5, transition_contrast=4,
                    mask_influence=0, difference_threshold=.5, difference_contrast=2)
    defaults.update(json.loads(settings or "{}"))
    return defaults


def _inpaint_resize(tensor, width, height, mode="bilinear"):
    return torch.nn.functional.interpolate(tensor, size=(height, width), mode=mode,
                                           **({"align_corners": False} if mode == "bilinear" else {}))


class MooshieInpaintPrepare:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "mask": ("MASK",),
                "width": ("INT", {"default": 1024, "min": 64, "max": 16384}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 16384}),
                "grow": ("INT", {"default": 0, "min": 0, "max": 256}),
                "settings": ("STRING", {"default": "{}"})},
                "optional": {
                    "target_width": ("INT", {"default": 0, "min": 0, "max": 16384}),
                    "target_height": ("INT", {"default": 0, "min": 0, "max": 16384}),
                }}
    RETURN_TYPES = ("IMAGE", "MASK", "MOOSHIE_INPAINT_CONTEXT")
    FUNCTION = "prepare"
    CATEGORY = "mooshie/inpainting"

    def prepare(self, image, mask, width, height, grow, settings, target_width=0, target_height=0):
        opts = _inpaint_options(settings)
        image = image[..., :3]
        b, ih, iw, _ = image.shape
        # Match mask coordinates to the source image before applying one shared resize.
        mask = _inpaint_resize(mask.reshape(-1, 1, *mask.shape[-2:]).to(image.device), iw, ih)
        if mask.shape[0] == 1 and b > 1:
            mask = mask.expand(b, -1, -1, -1)
        rgb = image.movedim(-1, 1)
        mode = opts["resize_mode"]
        if mode in ("crop", "fill"):
            scale = (max if mode == "crop" else min)(width / iw, height / ih)
            rw, rh = max(1, round(iw * scale)), max(1, round(ih * scale))
            rgb = _inpaint_resize(rgb, rw, rh)
            mask = _inpaint_resize(mask, rw, rh)
            if mode == "crop":
                x, y = (rw-width)//2, (rh-height)//2
                rgb, mask = rgb[:, :, y:y+height, x:x+width], mask[:, :, y:y+height, x:x+width]
            else:
                px, py = width-rw, height-rh
                padding = (px//2, px-px//2, py//2, py-py//2)
                rgb = torch.nn.functional.pad(rgb, padding, mode="replicate")
                mask = torch.nn.functional.pad(mask, padding)
        else:
            rgb, mask = _inpaint_resize(rgb, width, height), _inpaint_resize(mask, width, height)
        mask = mask.clamp(0, 1)
        if opts["invert_mask"]:
            mask = 1-mask
        grow = max(0, min(256, int(grow)))
        if grow:
            mask = torch.nn.functional.max_pool2d(mask, 2*grow+1, stride=1, padding=grow)
        sigma = max(0, min(64, float(opts["mask_blur"])))
        if sigma:
            radius = max(1, int(3*sigma))
            grid = torch.arange(-radius, radius+1, device=mask.device, dtype=mask.dtype)
            kernel = torch.exp(-grid.square()/(2*sigma*sigma))
            kernel /= kernel.sum()
            mask = torch.nn.functional.conv2d(torch.nn.functional.pad(mask, (radius,radius,0,0), mode="replicate"), kernel.view(1,1,1,-1))
            mask = torch.nn.functional.conv2d(torch.nn.functional.pad(mask, (0,0,radius,radius), mode="replicate"), kernel.view(1,1,-1,1))
        base = rgb.movedim(1, -1)
        x, y, cw, ch = 0, 0, width, height
        if opts["area"] == "masked":
            points = (mask.amax(dim=(0,1)) > .001).nonzero()
            if points.numel():
                fallback = max(0, min(256, int(opts["padding"])))
                pad_x = max(0, min(512, int(opts["context_padding_x"] if opts["context_padding_x"] is not None else fallback)))
                pad_y = max(0, min(512, int(opts["context_padding_y"] if opts["context_padding_y"] is not None else fallback)))
                minimum = max(0, min(4096, int(opts["context_min_size"])))
                top, left = [int(v) for v in points.amin(dim=0)]
                bottom, right = [int(v)+1 for v in points.amax(dim=0)]
                left, top = max(0, left-pad_x), max(0, top-pad_y)
                right, bottom = min(width, right+pad_x), min(height, bottom+pad_y)
                target_w, target_h = max(right-left, minimum), max(bottom-top, minimum)
                if opts["context_shape"] == "square":
                    target_w = target_h = max(target_w, target_h)
                target_w, target_h = min(width, target_w), min(height, target_h)
                cx, cy = (left+right)/2, (top+bottom)/2
                x = max(0, min(width-target_w, round(cx-target_w/2)))
                y = max(0, min(height-target_h, round(cy-target_h/2)))
                cw, ch = target_w, target_h
        context = {"base": base, "mask": mask.movedim(1,-1), "box": (x,y,cw,ch), "settings": opts}
        cropped_rgb = rgb[:, :, y:y+ch, x:x+cw]
        cropped_mask = mask[:, :, y:y+ch, x:x+cw]
        sample_width = max(64, min(16384, int(target_width or width)))
        sample_height = max(64, min(16384, int(target_height or height)))
        if opts["area"] == "masked" and opts["preserve_context_aspect"] and cw > 0 and ch > 0:
            crop_ratio, target_ratio = cw / ch, sample_width / sample_height
            if crop_ratio > target_ratio:
                sample_height = max(64, round(sample_width / crop_ratio))
            else:
                sample_width = max(64, round(sample_height * crop_ratio))
            # VAE-friendly dimensions without changing the crop's aspect materially.
            sample_width = max(64, round(sample_width / 8) * 8)
            sample_height = max(64, round(sample_height / 8) * 8)
        # ControlNet hints must use the exact sampler geometry. Passing a
        # cropped hint through the full document size first adds a second
        # interpolation and distorts non-square Only masked regions.
        context["sample_size"] = (sample_width, sample_height)
        sample_mask = _inpaint_resize(cropped_mask, sample_width, sample_height).squeeze(1)
        if opts["soft"]:
            sample_mask = sample_mask.pow(max(.01, min(8, float(opts["schedule_bias"]))))
        # Latent resize encodes native crop pixels, then resizes the latent in the encoder.
        pixels = cropped_rgb if mode == "latent" else _inpaint_resize(cropped_rgb, sample_width, sample_height)
        if mode == "latent" and opts["area"] == "whole":
            pixels = image.movedim(-1,1)
        if opts["masked_content"] == "fill":
            fill_mask = _inpaint_resize(cropped_mask, pixels.shape[-1], pixels.shape[-2])
            pixels = pixels*(1-fill_mask) + .5*fill_mask
        return pixels.movedim(1,-1), sample_mask, context


class MooshieInpaintEncode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pixels": ("IMAGE",), "mask": ("MASK",), "vae": ("VAE",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "settings": ("STRING", {"default": "{}"})}}
    RETURN_TYPES = ("LATENT",)
    FUNCTION = "encode"
    CATEGORY = "mooshie/inpainting"

    def encode(self, pixels, mask, vae, seed, settings):
        opts = _inpaint_options(settings)
        ratio = getattr(vae, "downscale_ratio", 8)
        if not isinstance(ratio, (int,float)):
            ratio = 8
        # Tiny masked crops in latent-resize mode must still be encodable.
        minimum = max(8, int(ratio))
        if pixels.shape[1] < minimum or pixels.shape[2] < minimum:
            pixels = _inpaint_resize(pixels.movedim(-1, 1),
                                     max(minimum, pixels.shape[2]),
                                     max(minimum, pixels.shape[1])).movedim(1, -1)
        samples = vae.encode(pixels[..., :3])
        lh, lw = max(1, round(mask.shape[-2]/ratio)), max(1, round(mask.shape[-1]/ratio))
        if samples.shape[-2:] != (lh,lw):
            samples = _inpaint_resize(samples, lw, lh)
        latent_mask = _inpaint_resize(mask.unsqueeze(1).to(samples.device), lw, lh)
        if opts["masked_content"] == "nothing":
            samples = samples*(1-latent_mask)
        elif opts["masked_content"] == "noise":
            generator = torch.Generator(device="cpu").manual_seed(seed)
            noise = torch.randn(samples.shape, generator=generator, dtype=samples.dtype).to(samples.device)
            samples = samples*(1-latent_mask) + noise*latent_mask
        # KSampler consumes noise_mask alongside `samples`, so it must have
        # the latent resolution. Returning the full-resolution brush mask here
        # made inpainting fail or apply to the wrong area whenever the VAE
        # downscaled the image, especially with latent resize.
        return ({"samples": samples, "noise_mask": latent_mask.squeeze(1)},)


class MooshieInpaintComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "context": ("MOOSHIE_INPAINT_CONTEXT",)}}
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "composite"
    CATEGORY = "mooshie/inpainting"

    def composite(self, image, context):
        base, mask, opts = context["base"], context["mask"], context["settings"]
        x,y,w,h = context["box"]
        patch = _inpaint_resize(image[..., :3].movedim(-1,1), w,h).movedim(1,-1).to(base.device)
        if base.shape[0] == 1 and patch.shape[0] > 1:
            base = base.expand(patch.shape[0], -1,-1,-1)
            mask = mask.expand(patch.shape[0], -1,-1,-1)
        original = base[:, y:y+h, x:x+w]
        alpha = mask[:, y:y+h, x:x+w].clamp(0,1)
        if opts["soft"]:
            preserve = max(0, min(1, float(opts["preservation"])))
            contrast = max(.01, min(16, float(opts["transition_contrast"])))
            alpha = alpha.pow(1 + preserve*contrast)
            difference = (patch-original).abs().mean(dim=-1, keepdim=True)
            threshold = max(0, min(1, float(opts["difference_threshold"])))
            sharpness = max(.01, min(16, float(opts["difference_contrast"])))
            influence = max(0, min(1, float(opts["mask_influence"])))
            gate = torch.sigmoid((difference - threshold*(1-influence*alpha))*sharpness*8)
            alpha = alpha*((1-preserve) + preserve*gate)
        result = base.clone()
        result[:, y:y+h, x:x+w] = original*(1-alpha) + patch*alpha
        return (result.clamp(0,1),)


class MooshieInpaintControl:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "context": ("MOOSHIE_INPAINT_CONTEXT",)}}
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "align"
    CATEGORY = "mooshie/inpainting"

    def align(self, image, context):
        _, height, width, _ = context["base"].shape
        opts = dict(context["settings"], area="whole", mask_blur=0, invert_mask=False,
                    masked_content="original", soft=False)
        if opts["resize_mode"] == "latent":
            opts["resize_mode"] = "resize"
        mask = torch.ones(image.shape[:3], device=image.device)
        pixels, _, _ = MooshieInpaintPrepare().prepare(image, mask, width, height, 0, json.dumps(opts))
        x,y,w,h = context["box"]
        sample_width, sample_height = context.get("sample_size", (width, height))
        cropped = pixels[:,y:y+h,x:x+w].movedim(-1,1)
        return (_inpaint_resize(cropped,sample_width,sample_height).movedim(1,-1),)


class MooshieInpaintConditionMask:
    """Align a prompt-region mask to the exact crop and size sampled by inpainting."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "context": ("MOOSHIE_INPAINT_CONTEXT",),
                "x": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0}),
                "y": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0}),
                "width": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
                "height": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
            },
            "optional": {"mask": ("MASK",)},
        }

    RETURN_TYPES = ("MASK",)
    FUNCTION = "align"
    CATEGORY = "mooshie/inpainting"

    def align(self, context, x, y, width, height, mask=None):
        base = context["base"]
        batch, document_height, document_width, _ = base.shape
        if mask is None:
            document_mask = torch.zeros(
                (1, 1, document_height, document_width),
                device=base.device,
                dtype=base.dtype,
            )
            left = max(0, min(document_width, round(float(x) * document_width)))
            top = max(0, min(document_height, round(float(y) * document_height)))
            right = max(left, min(document_width, round((float(x) + float(width)) * document_width)))
            bottom = max(top, min(document_height, round((float(y) + float(height)) * document_height)))
            document_mask[:, :, top:bottom, left:right] = 1
        else:
            document_mask = mask.reshape(-1, 1, *mask.shape[-2:]).to(base.device, dtype=base.dtype)
            document_mask = _inpaint_resize(document_mask, document_width, document_height)

        if document_mask.shape[0] == 1 and batch > 1:
            document_mask = document_mask.expand(batch, -1, -1, -1)
        crop_x, crop_y, crop_width, crop_height = context["box"]
        sample_width, sample_height = context.get("sample_size", (document_width, document_height))
        cropped = document_mask[:, :, crop_y:crop_y+crop_height, crop_x:crop_x+crop_width]
        return (_inpaint_resize(cropped, sample_width, sample_height).squeeze(1).clamp(0, 1),)


NODE_CLASS_MAPPINGS = {
    "MooshieInpaintControl": MooshieInpaintControl,
    "MooshieInpaintConditionMask": MooshieInpaintConditionMask,
    "MooshieInpaintPrepare": MooshieInpaintPrepare,
    "MooshieInpaintEncode": MooshieInpaintEncode,
    "MooshieInpaintComposite": MooshieInpaintComposite,
    "MooshieYuE2Plan": MooshieYuE2Plan,
    "MooshieYuE2Music": MooshieYuE2Music,
    "MooshieMusicLoadAudio": MooshieMusicLoadAudio,
    "MooshieSigmaTail": MooshieSigmaTail,
    "MooshieResumeEdit": MooshieResumeEdit,
    "MooshieFaceDetailer": MooshieFaceDetailer,
    "MooshieFaceDetect": MooshieFaceDetect,
    "MooshieSegmentDetailer": MooshieSegmentDetailer,
    "MooshieSaveImage": MooshieSaveImage,
    "MooshieCheckpointLoaderPath": MooshieCheckpointLoaderPath,
    "MooshieDiffusionLoaderPath": MooshieDiffusionLoaderPath,
    "MooshieSaveVideo": MooshieSaveVideo,
    "MooshieLoadVideoPath": MooshieLoadVideoPath,
}

from .h3_drafts import NODE_CLASS_MAPPINGS as H3_DRAFT_NODES, register_routes as register_h3_draft_routes
NODE_CLASS_MAPPINGS.update(H3_DRAFT_NODES)
register_h3_draft_routes()

NODE_DISPLAY_NAME_MAPPINGS = {
    "MooshieInpaintControl": "Mooshie Inpaint Control",
    "MooshieInpaintConditionMask": "Mooshie Inpaint Condition Mask",
    "MooshieInpaintPrepare": "Mooshie Inpaint Prepare",
    "MooshieInpaintEncode": "Mooshie Inpaint Encode",
    "MooshieInpaintComposite": "Mooshie Inpaint Composite",
    "MooshieYuE2Plan": "Mooshie YuE2 Score and Status",
    "MooshieYuE2Music": "Mooshie YuE2 Music and Status",
    "MooshieMusicLoadAudio": "Mooshie Temporary Cover Audio",
    "MooshieSigmaTail": "Mooshie Sigma Tail (resume)",
    "MooshieResumeEdit": "Mooshie Resume Edit (paused latent)",
    "MooshieFaceDetailer": "Mooshie Face Detailer",
    "MooshieFaceDetect": "Mooshie Face Detect",
    "MooshieSegmentDetailer": "Mooshie Segment Detailer",
    "MooshieSaveImage": "Mooshie Save Image",
    "MooshieCheckpointLoaderPath": "Mooshie Checkpoint Loader (path)",
    "MooshieDiffusionLoaderPath": "Mooshie Diffusion Model Loader (path)",
    "MooshieSaveVideo": "Mooshie Save Video",
    "MooshieLoadVideoPath": "Mooshie Load Video (Path)",
}
