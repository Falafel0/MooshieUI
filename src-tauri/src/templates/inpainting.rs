use serde_json::json;

use super::{
    build_regional_context_prompt, build_scheduled_conditioning, insert_vae_decode, is_vpred_model,
    load_model_nodes, merge_regional_encode_text, WorkflowResult,
};
use crate::comfyui::types::GenerationParams;

pub fn build(params: &GenerationParams, seed: i64) -> WorkflowResult {
    let mut workflow = serde_json::Map::new();
    let next_id: u32 = 1;

    // Load model (checkpoint or split UNETLoader + CLIPLoader + VAELoader)
    let ml = load_model_nodes(&mut workflow, next_id, params);
    let mut next_id = ml.next_id;
    let model_source = ml.model_source;
    let clip_source = ml.clip_source;
    let vae_source = ml.vae_source;

    // Positive conditioning (with optional timestep scheduling)
    let (mut pos_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.positive_prompt,
        &params.positive_segments,
    );
    next_id = nid;

    // Negative conditioning (with optional timestep scheduling)
    let (mut neg_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.negative_prompt,
        &params.negative_segments,
    );
    next_id = nid;

    // Prompt regions are conditioning masks, not extra inpaint operations.
    // The document mask still decides which pixels may change; these nodes
    // only change prompt influence where a region overlaps that document mask.
    let regional_context = build_regional_context_prompt(params);
    for region in &params.positive_regions {
        let x = region.x.clamp(0.0, 1.0);
        let y = region.y.clamp(0.0, 1.0);
        let w = region.width.clamp(0.0, 1.0 - x);
        let h = region.height.clamp(0.0, 1.0 - y);
        if w <= 0.0 || h <= 0.0 {
            continue;
        }

        let mask_source = region.mask_image.as_ref().map(|name| {
            let id = next_id.to_string();
            workflow.insert(
                id.clone(),
                json!({
                    "class_type": "LoadImageMask",
                    "inputs": { "image": name, "channel": "red" }
                }),
            );
            next_id += 1;
            (id, 0)
        });

        let positive_text = merge_regional_encode_text(&regional_context, &region.text);
        if !positive_text.trim().is_empty() {
            let encode_id = next_id.to_string();
            workflow.insert(encode_id.clone(), json!({
                "class_type": "CLIPTextEncode",
                "inputs": { "text": positive_text, "clip": [clip_source.0.clone(), clip_source.1] }
            }));
            next_id += 1;
            let spatial_id = next_id.to_string();
            let spatial = if let Some((mask_id, slot)) = mask_source.as_ref() {
                json!({ "class_type": "ConditioningSetMask", "inputs": {
                    "conditioning": [encode_id, 0], "mask": [mask_id, slot],
                    "strength": region.strength.clamp(0.0, 2.0), "set_cond_area": "default"
                }})
            } else {
                json!({ "class_type": "ConditioningSetAreaPercentage", "inputs": {
                    "conditioning": [encode_id, 0], "x": x, "y": y, "width": w, "height": h,
                    "strength": region.strength.clamp(0.0, 2.0)
                }})
            };
            workflow.insert(spatial_id.clone(), spatial);
            next_id += 1;
            let combine_id = next_id.to_string();
            workflow.insert(combine_id.clone(), json!({
                "class_type": "ConditioningCombine",
                "inputs": { "conditioning_1": [pos_source.0.clone(), pos_source.1], "conditioning_2": [spatial_id, 0] }
            }));
            pos_source = (combine_id, 0);
            next_id += 1;
        }

        if let Some(local_negative) = region
            .negative_text
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            let negative_text = merge_regional_encode_text(&params.negative_prompt, local_negative);
            let encode_id = next_id.to_string();
            workflow.insert(encode_id.clone(), json!({
                "class_type": "CLIPTextEncode",
                "inputs": { "text": negative_text, "clip": [clip_source.0.clone(), clip_source.1] }
            }));
            next_id += 1;
            let spatial_id = next_id.to_string();
            let spatial = if let Some((mask_id, slot)) = mask_source.as_ref() {
                json!({ "class_type": "ConditioningSetMask", "inputs": {
                    "conditioning": [encode_id, 0], "mask": [mask_id, slot],
                    "strength": region.strength.clamp(0.0, 2.0), "set_cond_area": "default"
                }})
            } else {
                json!({ "class_type": "ConditioningSetAreaPercentage", "inputs": {
                    "conditioning": [encode_id, 0], "x": x, "y": y, "width": w, "height": h,
                    "strength": region.strength.clamp(0.0, 2.0)
                }})
            };
            workflow.insert(spatial_id.clone(), spatial);
            next_id += 1;
            let combine_id = next_id.to_string();
            workflow.insert(combine_id.clone(), json!({
                "class_type": "ConditioningCombine",
                "inputs": { "conditioning_1": [neg_source.0.clone(), neg_source.1], "conditioning_2": [spatial_id, 0] }
            }));
            neg_source = (combine_id, 0);
            next_id += 1;
        }
    }

    // Load input image
    let load_img_id = next_id.to_string();
    workflow.insert(
        load_img_id.clone(),
        json!({
            "class_type": "LoadImage",
            "inputs": {
                "image": params.input_image.as_deref().unwrap_or("")
            }
        }),
    );
    next_id += 1;

    // Load mask
    let load_mask_id = next_id.to_string();
    workflow.insert(
        load_mask_id.clone(),
        json!({
            "class_type": "LoadImageMask",
            "inputs": {
                "image": params.mask_image.as_deref().unwrap_or(""),
                "channel": "red"
            }
        }),
    );
    next_id += 1;

    let settings = params
        .inpaint_settings
        .clone()
        .unwrap_or_else(|| json!({}))
        .to_string();
    let prepare_id = next_id.to_string();
    workflow.insert(
        prepare_id.clone(),
        json!({
            "class_type": "MooshieInpaintPrepare",
            "inputs": {
                "image": [load_img_id, 0], "mask": [load_mask_id, 0],
                "width": params.width, "height": params.height,
                "target_width": params.inpaint_target_width.unwrap_or(params.width),
                "target_height": params.inpaint_target_height.unwrap_or(params.height),
                "grow": params.grow_mask_by.unwrap_or(0), "settings": settings
            }
        }),
    );
    next_id += 1;
    let masked_latent_id = next_id.to_string();
    workflow.insert(
        masked_latent_id.clone(),
        json!({
            "class_type": "MooshieInpaintEncode",
            "inputs": {
                "pixels": [prepare_id.clone(), 0], "mask": [prepare_id.clone(), 1],
                "vae": [vae_source.0.clone(), vae_source.1], "seed": seed,
                "settings": settings
            }
        }),
    );
    next_id += 1;

    let sampler_name_lc = params.sampler_name.to_lowercase();
    let is_cfgpp_sampler = sampler_name_lc.contains("cfg_pp");
    let is_vpred_or_anima = is_vpred_model(params) || params.model_architecture == "anima";

    let use_differential_diffusion = params.differential_diffusion
        || params
            .inpaint_settings
            .as_ref()
            .and_then(|s| s.get("soft"))
            .and_then(|s| s.as_bool())
            .unwrap_or(false)
        || (is_vpred_or_anima && !is_cfgpp_sampler);

    let mut sampler_model_source = model_source.clone();
    if use_differential_diffusion {
        let differential_id = next_id.to_string();
        workflow.insert(
            differential_id.clone(),
            json!({
                "class_type": "DifferentialDiffusion",
                "inputs": {
                    "model": [model_source.0.clone(), model_source.1]
                }
            }),
        );
        sampler_model_source = (differential_id, 0);
        next_id += 1;
    }

    // KSampler
    let sampler_id = next_id.to_string();
    workflow.insert(
        sampler_id.clone(),
        json!({
            "class_type": "KSampler",
            "inputs": {
                "model": [sampler_model_source.0.clone(), sampler_model_source.1],
                "positive": [pos_source.0.clone(), pos_source.1],
                "negative": [neg_source.0.clone(), neg_source.1],
                "latent_image": [masked_latent_id, 0],
                "seed": seed,
                "steps": params.steps,
                "cfg": params.cfg,
                "sampler_name": params.sampler_name,
                "scheduler": params.scheduler,
                "denoise": params.denoise
            }
        }),
    );
    next_id += 1;

    // VAE Decode — VAEDecodeTiled for Mugen (Flux2VAE SDXL), VAEDecode otherwise
    let (decode_id, mut next_id) =
        insert_vae_decode(&mut workflow, next_id, &sampler_id, &vae_source, params);

    let composite_id = next_id.to_string();
    workflow.insert(
        composite_id.clone(),
        json!({
            "class_type": "MooshieInpaintComposite",
            "inputs": { "image": [decode_id, 0], "context": [prepare_id, 2] }
        }),
    );
    next_id += 1;

    WorkflowResult {
        workflow,
        next_id,
        image_output: (composite_id, 0),
        // Expose the model the KSampler is actually wired to (the
        // DifferentialDiffusion node when enabled), not the raw checkpoint.
        // The post-build injectors (vpred/zsnr, cascade, smart-guidance, ...)
        // chain new model patches onto `model_source` and rewire the sampler
        // to them. Returning the raw model here let those injectors re-point
        // the sampler past the DifferentialDiffusion node, silently dropping
        // it — which is exactly the v-pred/Anima inpaint case where it is
        // auto-enabled. Anchoring on the wired model keeps it in the chain.
        model_source: sampler_model_source,
        clip_source,
        positive_source: pos_source,
        negative_source: neg_source,
        vae_source,
        sampler_id,
        refiner_model_source: None,
        base_sources: None,
    }
}
#[cfg(test)]
mod workspace_tests {
    use super::*;
    use crate::comfyui::types::PositiveRegion;

    #[test]
    fn workspace_mask_pipeline_and_export() {
        let params = GenerationParams {
            mode: "inpainting".into(),
            checkpoint: "Juice.safetensors".into(),
            model_architecture: "sdxl".into(),
            positive_prompt: "a small red flower, painting".into(),
            negative_prompt: "blurry".into(),
            width: 256,
            height: 256,
            batch_size: 1,
            steps: 2,
            cfg: 1.4,
            sampler_name: "euler".into(),
            scheduler: "normal".into(),
            denoise: 0.75,
            input_image: Some("workspace-base.png".into()),
            mask_image: Some("workspace-mask.png".into()),
            grow_mask_by: Some(2),
            inpaint_settings: Some(
                json!({"area":"masked", "padding":16,"mask_blur":4,"soft":true}),
            ),
            inpaint_target_width: Some(768),
            inpaint_target_height: Some(512),
            positive_regions: vec![PositiveRegion {
                text: "red hair".into(),
                negative_text: Some("blue hair".into()),
                mask_image: Some("prompt-region.png".into()),
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
                strength: 0.8,
            }],
            ..Default::default()
        };
        let result = build(&params, 123);
        let classes: Vec<_> = result
            .workflow
            .values()
            .filter_map(|n| n["class_type"].as_str())
            .collect();
        assert!(classes.contains(&"MooshieInpaintPrepare"));
        assert!(classes.contains(&"MooshieInpaintEncode"));
        assert!(classes.contains(&"MooshieInpaintComposite"));
        assert!(classes.contains(&"DifferentialDiffusion"));
        assert_eq!(
            classes
                .iter()
                .filter(|class| **class == "ConditioningSetMask")
                .count(),
            2
        );
        assert_eq!(
            result.workflow[&result.image_output.0]["class_type"],
            "MooshieInpaintComposite"
        );
        let prepare = result
            .workflow
            .values()
            .find(|node| node["class_type"] == "MooshieInpaintPrepare")
            .unwrap();
        assert_eq!(prepare["inputs"]["width"], 256);
        assert_eq!(prepare["inputs"]["height"], 256);
        assert_eq!(prepare["inputs"]["target_width"], 768);
        assert_eq!(prepare["inputs"]["target_height"], 512);
        for node in result.workflow.values() {
            for value in node["inputs"].as_object().unwrap().values() {
                if let Some(connection) = value.as_array() {
                    if let Some(id) = connection.first().and_then(|v| v.as_str()) {
                        assert!(result.workflow.contains_key(id), "missing node {id}");
                    }
                }
            }
        }
        if let Ok(path) = std::env::var("MOOSHIE_INPAINT_TEST_WORKFLOW") {
            let mut graph = result.workflow;
            graph.insert(result.next_id.to_string(), json!({"class_type":"SaveImage", "inputs":{
                "images":[result.image_output.0,result.image_output.1], "filename_prefix":"workspace-test"
            }}));
            std::fs::write(path, serde_json::to_vec_pretty(&graph).unwrap()).unwrap();
        }
    }
}
