"""CPU tests of the actual bundled inpaint nodes, without starting ComfyUI."""
import ast
import json
import unittest
from pathlib import Path
import torch

source = Path(__file__).parents[1] / 'src-tauri/src/comfyui/mooshie_nodes.py'
tree = ast.parse(source.read_text(encoding='utf-8-sig'))
names = {'_inpaint_options', '_inpaint_resize', 'MooshieInpaintPrepare', 'MooshieInpaintEncode', 'MooshieInpaintComposite'}
namespace = dict(torch=torch, json=json)
exec(compile(ast.Module(body=[n for n in tree.body if getattr(n, 'name', '') in names], type_ignores=[]), str(source), 'exec'), namespace)
Prepare, Encode, Composite = [namespace[name]() for name in ('MooshieInpaintPrepare','MooshieInpaintEncode','MooshieInpaintComposite')]

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

    def test_tiny_latent_crop_is_encodable(self):
        class Vae:
            downscale_ratio = 8
            def encode(self, pixels):
                assert pixels.shape[1] >= 8 and pixels.shape[2] >= 8
                return torch.zeros((1, 4, pixels.shape[1]//8, pixels.shape[2]//8))
        result, = Encode.encode(torch.ones((1,1,2,3)), self.mask, Vae(), 1, '{}')
        self.assertEqual(result['samples'].shape, (1,4,8,12))

if __name__ == '__main__': unittest.main()
