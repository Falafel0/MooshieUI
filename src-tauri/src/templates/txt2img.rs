use serde_json::json;

use super::{
    build_regional_context_prompt, build_scheduled_conditioning, insert_vae_decode,
    load_model_nodes, merge_regional_encode_text, needs_flux2_latent, needs_sd3_latent,
    WorkflowResult,
};
use crate::comfyui::types::GenerationParams;

pub fn build(params: &GenerationParams, seed: i64) -> WorkflowResult {
    let mut workflow = serde_json::Map::new();
    // A later stage of a paused run allocates its node IDs after the stages
    // before it, whose nodes it shares the graph with.
    let next_id: u32 = params.stage.as_ref().map_or(1, |s| s.first_id.max(1));

    // Load model (checkpoint or split UNETLoader + CLIPLoader + VAELoader)
    let ml = load_model_nodes(&mut workflow, next_id, params);
    let mut next_id = ml.next_id;
    let model_source = ml.model_source;
    let clip_source = ml.clip_source;
    let vae_source = ml.vae_source;
    let base_sources = ml.base;

    // Positive conditioning (with optional timestep scheduling)
    let (mut pos_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.positive_prompt,
        &params.positive_segments,
    );
    next_id = nid;

    // Regional prompting (syntax-first): <region:x1,y1,x2,y2>text</region>
    //
    // Two shapes, because they address the latent differently:
    // - SDXL family: ConditioningSetAreaPercentage. Its area tuple matches those
    //   models' 2-D latents and the sampler resolves it without extra nodes.
    // - Anima: latents carry an extra leading dimension, so percentage-area
    //   tuples do not match the sampler's spatial dimensions. Use a standard
    //   ConditioningSetMask instead; it scales the region mask to the latent
    //   shape and conditions only within that area (not an inpaint pass).
    let area_regions = matches!(params.model_architecture.as_str(), "sdxl" | "illustrious");
    let masked_regions = params.model_architecture == "anima";
    if params.mode == "txt2img" && (area_regions || masked_regions) {
        let regional_context = build_regional_context_prompt(params);
        for region in &params.positive_regions {
            let text = merge_regional_encode_text(&regional_context, &region.text)
                .trim()
                .to_string();
            if text.is_empty() {
                continue;
            }

            let x = region.x.clamp(0.0, 1.0);
            let y = region.y.clamp(0.0, 1.0);
            let w = region.width.clamp(0.0, 1.0 - x);
            let h = region.height.clamp(0.0, 1.0 - y);
            if w <= 0.0 || h <= 0.0 {
                continue;
            }

            let region_encode_id = next_id.to_string();
            workflow.insert(
                region_encode_id.clone(),
                json!({
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": text,
                        "clip": [clip_source.0.clone(), clip_source.1]
                    }
                }),
            );
            next_id += 1;

            let spatial_id = if masked_regions {
                // Anima's latent keeps a leading frame axis, so percentage-area
                // conditioning does not match the sampler's spatial dimensions.
                // Use a standard rank-3 ComfyUI mask to limit influence spatially;
                // the sampler resizes it to the latent dimensions.
                let mask_id = next_id.to_string();
                workflow.insert(
                    mask_id.clone(),
                    json!({
                        "class_type": "MooshieRegionalMask",
                        "inputs": {
                            "width": params.width.max(1),
                            "height": params.height.max(1),
                            "x": x,
                            "y": y,
                            "region_width": w,
                            "region_height": h
                        }
                    }),
                );
                next_id += 1;

                let set_mask_id = next_id.to_string();
                workflow.insert(
                    set_mask_id.clone(),
                    json!({
                        "class_type": "ConditioningSetMask",
                        "inputs": {
                            "conditioning": [region_encode_id, 0],
                            "mask": [mask_id, 0],
                            "strength": region.strength.clamp(0.0, 2.0),
                            // Keep conditioning spatially masked without asking
                            // ComfyUI to derive a 2-D bounding box from Anima's
                            // extra latent axis.
                            "set_cond_area": "default"
                        }
                    }),
                );
                next_id += 1;
                set_mask_id
            } else {
                let region_area_id = next_id.to_string();
                workflow.insert(
                    region_area_id.clone(),
                    json!({
                        "class_type": "ConditioningSetAreaPercentage",
                        "inputs": {
                            "conditioning": [region_encode_id, 0],
                            "x": x,
                            "y": y,
                            "width": w,
                            "height": h,
                            "strength": region.strength.clamp(0.0, 2.0)
                        }
                    }),
                );
                next_id += 1;
                region_area_id
            };

            let region_combine_id = next_id.to_string();
            workflow.insert(
                region_combine_id.clone(),
                json!({
                    "class_type": "ConditioningCombine",
                    "inputs": {
                        "conditioning_1": [pos_source.0.clone(), pos_source.1],
                        "conditioning_2": [spatial_id, 0]
                    }
                }),
            );
            pos_source = (region_combine_id, 0);
            next_id += 1;
        }
    }

    // Negative conditioning (with optional timestep scheduling)
    let (neg_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.negative_prompt,
        &params.negative_segments,
    );
    next_id = nid;

    let stage = params.stage.as_ref();

    // Latent: a resumed stage continues from the previous stage's sampler
    // output; otherwise an empty latent of the architecture-specific kind.
    let latent_source: (String, u32) = if let Some(latent) = stage.and_then(|s| s.latent.clone()) {
        latent
    } else {
        let latent_id = next_id.to_string();
        let use_flux2_latent = needs_flux2_latent(params);
        let use_sd3_latent = needs_sd3_latent(params);
        workflow.insert(
            latent_id.clone(),
            json!({
                "class_type":
                if use_flux2_latent {
                    "EmptyFlux2LatentImage"
                } else if use_sd3_latent {
                    "EmptySD3LatentImage"
                } else {
                    "EmptyLatentImage"
                },
                "inputs": {
                    "width": params.width,
                    "height": params.height,
                    "batch_size": params.batch_size
                }
            }),
        );
        next_id += 1;
        (latent_id, 0)
    };

    // Sampler. A plain KSampler runs the whole schedule; a paused or resumed
    // stage uses KSamplerAdvanced so it can stop early and hand the leftover
    // noise to the next stage, or pick up from a stage that did.
    let start_step = stage.map_or(0, |s| s.start_step);
    let end_step = stage.and_then(|s| s.end_step);
    let custom_tail = stage.is_some_and(|s| s.custom_tail);

    // A finishing stage on a different scheduler or step count samples an
    // explicit sigma tail. `inject_resume_stage` builds the tail from the
    // patched model and fills in `sigmas`; the placeholder never reaches
    // ComfyUI.
    let sampler_select_id = if custom_tail {
        let id = next_id.to_string();
        workflow.insert(
            id.clone(),
            json!({
                "class_type": "KSamplerSelect",
                "inputs": { "sampler_name": params.sampler_name }
            }),
        );
        next_id += 1;
        Some(id)
    } else {
        None
    };

    let sampler_id = next_id.to_string();
    let sampler_node = if let Some(select_id) = sampler_select_id {
        json!({
            "class_type": "SamplerCustom",
            "inputs": {
                "model": [model_source.0.clone(), model_source.1],
                "positive": [pos_source.0.clone(), pos_source.1],
                "negative": [neg_source.0.clone(), neg_source.1],
                "latent_image": [latent_source.0, latent_source.1],
                "add_noise": false,
                "noise_seed": seed,
                "cfg": params.cfg,
                "sampler": [select_id, 0],
                "sigmas": ["0", 0]
            }
        })
    } else if start_step == 0 && end_step.is_none() {
        json!({
            "class_type": "KSampler",
            "inputs": {
                "model": [model_source.0.clone(), model_source.1],
                "positive": [pos_source.0.clone(), pos_source.1],
                "negative": [neg_source.0.clone(), neg_source.1],
                "latent_image": [latent_source.0, latent_source.1],
                "seed": seed,
                "steps": params.steps,
                "cfg": params.cfg,
                "sampler_name": params.sampler_name,
                "scheduler": params.scheduler,
                "denoise": 1.0
            }
        })
    } else {
        json!({
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "model": [model_source.0.clone(), model_source.1],
                "positive": [pos_source.0.clone(), pos_source.1],
                "negative": [neg_source.0.clone(), neg_source.1],
                "latent_image": [latent_source.0, latent_source.1],
                // Noise is added once, by the stage that starts the schedule.
                "add_noise": if start_step == 0 { "enable" } else { "disable" },
                "noise_seed": seed,
                "steps": params.steps,
                "cfg": params.cfg,
                "sampler_name": params.sampler_name,
                "scheduler": params.scheduler,
                "start_at_step": start_step,
                "end_at_step": end_step.unwrap_or(10000),
                // A stage that stops early must keep the remaining noise in
                // the latent, or the next stage would resume from a clean
                // latent at the wrong noise level.
                "return_with_leftover_noise": if end_step.is_some() { "enable" } else { "disable" }
            }
        })
    };
    workflow.insert(sampler_id.clone(), sampler_node);
    next_id += 1;

    // VAE Decode — VAEDecodeTiled for Mugen (Flux2VAE SDXL), VAEDecode otherwise
    let (decode_id, next_id) =
        insert_vae_decode(&mut workflow, next_id, &sampler_id, &vae_source, params);

    WorkflowResult {
        workflow,
        next_id,
        image_output: (decode_id, 0),
        model_source,
        clip_source,
        positive_source: pos_source,
        negative_source: neg_source,
        vae_source,
        sampler_id,
        refiner_model_source: None,
        base_sources: Some(base_sources),
    }
}

#[cfg(test)]
mod regional_tests {
    use super::*;
    use crate::comfyui::types::PositiveRegion;

    fn params_for(architecture: &str) -> GenerationParams {
        GenerationParams {
            mode: "txt2img".into(),
            checkpoint: "model.safetensors".into(),
            model_architecture: architecture.into(),
            positive_prompt: "a wide landscape".into(),
            width: 512,
            height: 512,
            batch_size: 1,
            steps: 2,
            cfg: 4.0,
            sampler_name: "euler".into(),
            scheduler: "normal".into(),
            positive_regions: vec![PositiveRegion {
                text: "blue sky".into(),
                negative_text: None,
                mask_image: None,
                x: 0.5,
                y: 0.0,
                width: 0.5,
                height: 0.5,
                strength: 1.0,
            }],
            ..Default::default()
        }
    }

    fn classes(params: &GenerationParams) -> Vec<String> {
        build(params, 7)
            .workflow
            .values()
            .filter_map(|node| node["class_type"].as_str().map(str::to_string))
            .collect()
    }

    /// Anima regions are spatial conditioning nodes, not sequential inpaint jobs.
    #[test]
    fn anima_regions_use_mask_conditioning_wired_into_the_base_prompt() {
        let graph = build(&params_for("anima"), 7).workflow;
        let node_id = |class_type: &str| {
            graph
                .iter()
                .find(|(_, node)| node["class_type"] == class_type)
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| panic!("missing workflow node {class_type}"))
        };
        let regional_mask_id = node_id("MooshieRegionalMask");
        let set_mask_id = node_id("ConditioningSetMask");
        let combine_id = node_id("ConditioningCombine");
        let regional_mask = &graph[&regional_mask_id];
        let set_mask = &graph[&set_mask_id];
        let combine = &graph[&combine_id];

        assert_eq!(regional_mask["inputs"]["width"], 512);
        assert_eq!(regional_mask["inputs"]["height"], 512);
        assert_eq!(regional_mask["inputs"]["x"], 0.5);
        assert_eq!(regional_mask["inputs"]["y"], 0.0);
        assert_eq!(regional_mask["inputs"]["region_width"], 0.5);
        assert_eq!(regional_mask["inputs"]["region_height"], 0.5);
        assert_eq!(set_mask["inputs"]["mask"], json!([regional_mask_id, 0]));
        assert_eq!(set_mask["inputs"]["set_cond_area"], "default");
        assert_eq!(combine["inputs"]["conditioning_2"], json!([set_mask_id, 0]));
        assert!(!graph
            .values()
            .any(|node| node["class_type"] == "ConditioningSetAreaPercentage"));
        assert!(!graph.values().any(|node| node["class_type"]
            .as_str()
            .is_some_and(|kind| kind.contains("Inpaint"))));
    }

    #[test]
    fn sdxl_regions_keep_the_percentage_area_path() {
        let found = classes(&params_for("sdxl"));
        assert!(found.iter().any(|c| c == "ConditioningSetAreaPercentage"));
        assert!(!found.iter().any(|c| c == "SolidMask"));
    }

    #[test]
    fn unknown_architectures_keep_regions_out_of_the_graph() {
        let found = classes(&params_for("sd15"));
        assert!(!found.iter().any(|c| c == "ConditioningSetAreaPercentage"));
        assert!(!found.iter().any(|c| c == "ConditioningSetMask"));
    }
}
