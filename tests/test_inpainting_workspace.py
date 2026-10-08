"""CPU tests of the actual bundled inpaint nodes, without starting ComfyUI."""
import ast
import json
import unittest
from pathlib import Path
import torch

source = Path(__file__).parents[1] / 'src-tauri/src/comfyui/mooshie_nodes.py'
tree = ast.parse(source.read_text(encoding='utf-8-sig'))
names = {'_inpaint_options', '_inpaint_resize', 'MooshieInpaintPrepare', 'MooshieInpaintEncode', 'MooshieInpaintComposite', 'MooshieInpaintControl', 'MooshieInpaintConditionMask'}
namespace = dict(torch=torch, json=json)
exec(compile(ast.Module(body=[n for n in tree.body if getattr(n, 'name', '') in names], type_ignores=[]), str(source), 'exec'), namespace)
Prepare, Encode, Composite = [namespace[name]() for name in ('MooshieInpaintPrepare','MooshieInpaintEncode','MooshieInpaintComposite')]
Control = namespace['MooshieInpaintControl']()
ConditionMask = namespace['MooshieInpaintConditionMask']()

class InpaintingTests(unittest.TestCase):
    def setUp(self):
        self.image = torch.full((1, 64, 96, 3), .25)
        self.mask = torch.zeros((1,64,96)); self.mask[:,20:40,30:50] = 1
    def prepare(self, **options):
        return Prepare.prepare(self.image, self.mask, 96,64,0,json.dumps(dict(mask_blur=0, **options)))
    def test_outside_mask_is_identical(self):
        pixels, mask, context = self.prepare()
        result, = Composite.composite(torch.ones_like(pixels), context)
        self.assertTrue(torch.equal(result[:,0:10], self.image[:,0:10]))
        self.assertEqual(result[0,25,35,0],1)
    def test_masked_crop_returns_to_original_coordinates(self):
        pixels, mask, context = self.prepare(area='masked', padding=0)
        self.assertEqual(context['box'], (30,20,20,20))
        result, = Composite.composite(torch.ones_like(pixels), context)
        self.assertEqual(result.shape, self.image.shape)
        self.assertEqual(result[0,25,35,0],1)
        self.assertEqual(result[0,10,10,0],.25)
    def test_invert_mask(self):
        _, mask, _ = self.prepare(invert_mask=True)
        self.assertEqual(mask[0,25,35],0)
        self.assertEqual(mask[0,0,0],1)
    def test_blur_and_grow(self):
        _, mask, _ = Prepare.prepare(self.image,self.mask,96,64,2,json.dumps({'mask_blur':2}))
        self.assertTrue(0 < mask[0,19,35] < 1)
    def test_resize_modes_share_mask_geometry(self):
        for mode in ['resize','crop','fill','latent']:
            pixels, mask, context = Prepare.prepare(self.image,self.mask,64,64,0,json.dumps({'resize_mode':mode,'mask_blur':0}))
            self.assertEqual(mask.shape, (1,64,64))
            result, = Composite.composite(torch.ones((1,64,64,3)),context)
            self.assertEqual(result.shape, (1,64,64,3))
            self.assertTrue(torch.isfinite(result).all())
    def test_per_mask_resolution_keeps_document_size(self):
        pixels, mask, context = Prepare.prepare(self.image, self.mask, 96, 64, 0,
            json.dumps({'mask_blur': 0}), 192, 128)
        self.assertEqual(pixels.shape, (1, 128, 192, 3))
        self.assertEqual(mask.shape, (1, 128, 192))
        result, = Composite.composite(torch.ones_like(pixels), context)
        self.assertEqual(result.shape, self.image.shape)
        self.assertEqual(result[0, 25, 35, 0], 1)
        self.assertEqual(result[0, 5, 5, 0], .25)
    def test_masked_high_resolution_preserves_context_aspect(self):
        pixels, mask, context = Prepare.prepare(self.image, self.mask, 96, 64, 0,
            json.dumps({'area': 'masked', 'padding': 0, 'mask_blur': 0,
                        'preserve_context_aspect': True}), 1024, 768)
        self.assertEqual(context['box'], (30, 20, 20, 20))
        self.assertEqual(pixels.shape[1:3], (768, 768))
        result, = Composite.composite(torch.ones_like(pixels), context)
        self.assertEqual(result.shape, self.image.shape)
    def test_edge_context_and_controlnet_share_sampler_geometry(self):
        mask = torch.zeros_like(self.mask)
        mask[:, 0:16, 72:96] = 1
        pixels, _, context = Prepare.prepare(self.image, mask, 96, 64, 0,
            json.dumps({'area': 'masked', 'mask_blur': 0,
                        'context_padding_x': 12, 'context_padding_y': 8,
                        'context_min_size': 40, 'preserve_context_aspect': True}),
            1024, 1024)
        self.assertEqual(context['box'], (56, 0, 40, 40))
        self.assertEqual(context['sample_size'], (1024, 1024))
        control, = Control.align(self.image, context)
        self.assertEqual(control.shape[1:3], pixels.shape[1:3])

    def test_regional_conditioning_uses_the_sampler_crop(self):
        pixels, _, context = self.prepare(area='masked', padding=0)
        region = torch.zeros_like(self.mask)
        region[:, 20:40, 30:40] = 1
        aligned, = ConditionMask.align(context, 0, 0, 1, 1, region)
        self.assertEqual(aligned.shape[-2:], pixels.shape[1:3])
        self.assertGreater(float(aligned[:, :, :aligned.shape[-1] // 2].mean()), .9)
        self.assertLess(float(aligned[:, :, aligned.shape[-1] // 2:].mean()), .1)

        box, = ConditionMask.align(context, 30/96, 20/64, 10/96, 20/64)
        self.assertTrue(torch.allclose(aligned, box))

        wide_mask = torch.zeros_like(self.mask)
        wide_mask[:, 4:16, 8:72] = 1
        pixels, _, context = Prepare.prepare(self.image, wide_mask, 96, 64, 0,
            json.dumps({'area': 'masked', 'mask_blur': 0,
                        'context_padding_x': 0, 'context_padding_y': 0,
                        'preserve_context_aspect': True}), 1024, 1024)
        self.assertEqual(context['sample_size'], (1024, 192))
        control, = Control.align(self.image, context)
        self.assertEqual(control.shape[1:3], pixels.shape[1:3])
    def test_empty_mask_preserves_image(self):
        _, _, context = Prepare.prepare(self.image,torch.zeros_like(self.mask),96,64,0,json.dumps({'area':'masked'}))
        result, = Composite.composite(torch.ones_like(self.image),context)
        self.assertTrue(torch.equal(result,self.image))
    def test_soft_preservation_and_schedule_have_effect(self):
        self.mask.fill_(.5)
        pixels, mask, context = self.prepare(soft=True,schedule_bias=2)
        self.assertAlmostEqual(float(mask.mean()),.25)
        soft, = Composite.composite(torch.ones_like(pixels),context)
        _, _, plain = self.prepare()
        hard, = Composite.composite(torch.ones_like(pixels),plain)
        self.assertTrue((soft < hard).all())
    def test_latent_content_and_seed(self):
        class Vae:
            downscale_ratio = 8
            def encode(self, pixels): return torch.ones((1,4,8,12))
        for mode in ['original','nothing','noise']:
            result, = Encode.encode(self.image,self.mask,Vae(),123,json.dumps({'masked_content':mode}))
            self.assertEqual(result['samples'].shape,(1,4,8,12))
            self.assertTrue(torch.isfinite(result['samples']).all())
            if mode == 'noise':
                again, = Encode.encode(self.image,self.mask,Vae(),123,json.dumps({'masked_content':mode}))
                self.assertTrue(torch.equal(result['samples'],again['samples']))

    def test_noise_mask_uses_the_latent_resolution(self):
        class Vae:
            downscale_ratio = 8
            def encode(self, pixels): return torch.ones((1,4,8,12))
        result, = Encode.encode(self.image, self.mask, Vae(), 123, '{}')
        self.assertEqual(result['samples'].shape[-2:], (8, 12))
        self.assertEqual(result['noise_mask'].shape, (1, 8, 12))
        # The painted centre survives the resize, while untouched corners do not.
        self.assertGreater(float(result['noise_mask'][0, 3, 5]), 0)
        self.assertEqual(float(result['noise_mask'][0, 0, 0]), 0)

    def test_tiny_latent_crop_is_encodable(self):
        class Vae:
            downscale_ratio = 8
            def encode(self, pixels):
                assert pixels.shape[1] >= 8 and pixels.shape[2] >= 8
                return torch.zeros((1, 4, pixels.shape[1]//8, pixels.shape[2]//8))
        result, = Encode.encode(torch.ones((1,1,2,3)), self.mask, Vae(), 1, '{}')
        self.assertEqual(result['samples'].shape, (1,4,8,12))

    def test_density_policy_changes_sampling_not_final_transparency(self):
        class Vae:
            downscale_ratio = 8
            def encode(self, pixels): return torch.ones((1,4,8,12))
        self.mask.fill_(.25)
        noise_masks = {}
        for density in [False, True, None]:
            options = dict(mask_blur=0)
            if density is not None:
                options['density_denoise'] = density
            settings = json.dumps(options)
            pixels, mask, context = Prepare.prepare(self.image,self.mask,96,64,0,settings)
            encoded, = Encode.encode(pixels,mask,Vae(),123,settings)
            noise_masks[density] = encoded['noise_mask']
            result, = Composite.composite(torch.ones_like(pixels),context)
            # Final blend remains 25%, independent of the sampling policy.
            self.assertTrue(torch.allclose(result, torch.full_like(result, .4375)))
            self.assertTrue(torch.equal(encoded['samples'], torch.ones_like(encoded['samples'])))
        self.assertTrue(torch.equal(noise_masks[False],torch.ones_like(noise_masks[False])))
        self.assertTrue(torch.allclose(noise_masks[True],torch.full_like(noise_masks[True],.25)))
        self.assertTrue(torch.equal(noise_masks[True],noise_masks[None]), 'legacy workflows retain fractional sampling')

    def test_uniform_density_keeps_zero_outside_the_painted_mask(self):
        class Vae:
            downscale_ratio = 8
            def encode(self, pixels): return torch.ones((1,4,8,12))
        self.mask *= .25
        settings = json.dumps(dict(mask_blur=0,density_denoise=False))
        pixels, mask, _ = Prepare.prepare(self.image,self.mask,96,64,0,settings)
        encoded, = Encode.encode(pixels,mask,Vae(),123,settings)
        values = encoded['noise_mask'].unique()
        self.assertTrue(torch.equal(values,torch.tensor([0.,1.])))
        self.assertEqual(float(encoded['noise_mask'][0,0,0]),0)
        self.assertEqual(float(encoded['noise_mask'][0,3,5]),1)

    def test_grow_and_blur_preserve_partial_mask_density(self):
        self.mask *= .5
        _, grown, context = Prepare.prepare(self.image,self.mask,96,64,2,
            json.dumps(dict(mask_blur=2,density_denoise=True)))
        self.assertGreater(float(grown[0,19,35]),0)
        self.assertLessEqual(float(grown.max()),.500001)
        result, = Composite.composite(torch.ones_like(self.image),context)
        self.assertGreater(float(result[0,19,35,0]),.25)
        self.assertLessEqual(float(result.max()),.625001)

    def test_soft_schedule_only_scales_density_when_sampling_uses_it(self):
        self.mask.fill_(.5)
        _, uniform, _ = self.prepare(soft=True,schedule_bias=2,density_denoise=False)
        _, varying, _ = self.prepare(soft=True,schedule_bias=2,density_denoise=True)
        self.assertTrue(torch.equal(uniform,torch.full_like(uniform,.5)))
        self.assertTrue(torch.equal(varying,torch.full_like(varying,.25)))

    def test_linked_raster_area_limits_growth_blur_and_inversion_without_double_alpha(self):
        limit = torch.zeros_like(self.mask)
        limit[:,18:42,28:52] = .5
        mask = self.mask * .5
        _, processed, context = Prepare.prepare(self.image, mask, 96, 64, 8,
            json.dumps(dict(mask_blur=2, density_denoise=False)), area_limit=limit)
        self.assertEqual(float(processed[0,5,5]),0)
        self.assertAlmostEqual(float(processed[0,30,40]),.5, places=5)
        result, = Composite.composite(torch.ones_like(self.image),context)
        self.assertTrue(torch.equal(result[0,5,5], self.image[0,5,5]))
        self.assertAlmostEqual(float(result[0,30,40,0]),.625, places=5)
        _, inverted, _ = Prepare.prepare(self.image, mask, 96, 64, 8,
            json.dumps(dict(mask_blur=2,invert_mask=True)), area_limit=limit)
        self.assertEqual(float(inverted[0,5,5]),0)
        self.assertLessEqual(float(inverted.max()),.5)

    def test_area_limit_tracks_resize_crop_fill_and_batch_geometry(self):
        image = self.image.expand(2, -1, -1, -1).clone()
        painted = torch.ones((2,64,96))
        limit = torch.zeros((1,64,96)); limit[:,16:48,24:72] = .4
        for mode in ['resize','crop','fill','latent']:
            with self.subTest(mode=mode):
                pixels, mask, context = Prepare.prepare(image, painted, 64,64,4,
                    json.dumps(dict(resize_mode=mode,mask_blur=2)), area_limit=limit)
                self.assertEqual(mask.shape,(2,64,64))
                self.assertAlmostEqual(float(mask[0,32,32]),.4,places=5)
                self.assertEqual(float(mask[0,0,0]),0)
                self.assertTrue(torch.equal(mask[0],mask[1]))
                result, = Composite.composite(torch.ones_like(pixels),context)
                self.assertTrue(torch.equal(result[:,0,0],pixels[:,0,0]))

    def test_area_limit_stays_in_document_coordinates_after_masked_high_resolution_sampling(self):
        limit=torch.zeros_like(self.mask); limit[:,24:36,34:46]=.4
        pixels, mask, context=Prepare.prepare(self.image,self.mask,96,64,8,
            json.dumps(dict(area='masked',padding=4,mask_blur=2)),192,128,area_limit=limit)
        self.assertLessEqual(float(mask.max()),.400001)
        result, = Composite.composite(torch.ones_like(pixels),context)
        self.assertEqual(result.shape,self.image.shape)
        self.assertTrue(torch.equal(result[0,0,0],self.image[0,0,0]))
        self.assertAlmostEqual(float(result[0,30,40,0]),.55,places=5)

if __name__ == '__main__': unittest.main()
