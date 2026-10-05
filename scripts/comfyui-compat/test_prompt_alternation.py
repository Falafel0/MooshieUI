"""Exercise sampler dispatch without loading ComfyUI or model weights."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[2] / "src-tauri/src/comfyui/mooshie_nodes.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
definitions = [
    node for node in tree.body
    if (isinstance(node, ast.FunctionDef) and node.name == "_alternation_sampler_wrapper")
    or (isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == "_ALTERNATION_SAMPLER_FUNCTIONS"
        for target in node.targets
    ))
]
namespace = {"torch": SimpleNamespace(all=all)}
exec(compile(ast.Module(body=definitions, type_ignores=[]), str(SOURCE), "exec"), namespace)
wrapper = namespace["_alternation_sampler_wrapper"]


class Sigmas(list):
    ndim = 1

    def __getitem__(self, key):
        value = super().__getitem__(key)
        return Sigmas(value) if isinstance(key, slice) else value

    def __gt__(self, other):
        return [a > b for a, b in zip(self, other)]


class Executor:
    def __init__(self, sampler, **options):
        function = lambda: None
        function.__name__ = "sample_" + sampler
        self.class_obj = SimpleNamespace(sampler_function=function, extra_options=options)
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        return "sampled"


class AlternationSamplerTests(unittest.TestCase):
    def test_res_and_cfg_pp_preserve_schedule_and_conditioning_wrappers(self):
        for sampler in (
            "res_multistep", "res_multistep_cfg_pp", "res_multistep_ancestral",
            "res_multistep_ancestral_cfg_pp", "euler_cfg_pp",
            "euler_ancestral_cfg_pp", "dpmpp_2m_cfg_pp",
        ):
            with self.subTest(sampler=sampler):
                executor = Executor(sampler)
                sigmas = Sigmas([1.0, 0.7, 0.2, 0.0])
                batch_wrapper = object()
                options = {"transformer_options": {"existing": True},
                           "wrappers": {"calc_cond_batch": batch_wrapper}}
                args = {"model_options": options}
                result = wrapper(executor, "model", sigmas, args, "callback", "noise")
                self.assertEqual(result, "sampled")
                self.assertIs(options["transformer_options"]["mooshie_alternation_sigmas"], sigmas)
                self.assertTrue(options["transformer_options"]["existing"])
                self.assertIs(options["wrappers"]["calc_cond_batch"], batch_wrapper)
                self.assertEqual(len(executor.calls), 1)
                self.assertIs(executor.calls[0][1], sigmas)
                self.assertIs(executor.calls[0][2], args)

    def test_unsupported_sampler_does_not_execute(self):
        for sampler in ("heun", "dpmpp_2s_ancestral_cfg_pp", "dpm_adaptive"):
            executor = Executor(sampler)
            with self.assertRaisesRegex(ValueError, "no every-step"):
                wrapper(executor, None, Sigmas([1.0, 0.0]), {}, None, None)
            self.assertEqual(executor.calls, [])

    def test_cfg_pp_does_not_bypass_schedule_or_churn_validation(self):
        with self.assertRaisesRegex(ValueError, "strictly decreasing"):
            wrapper(Executor("euler_cfg_pp"), None, Sigmas([1.0, 1.0, 0.0]), {}, None, None)
        with self.assertRaisesRegex(ValueError, "churn"):
            wrapper(Executor("euler_cfg_pp", s_churn=1), None, Sigmas([1.0, 0.0]), {}, None, None)


if __name__ == "__main__":
    unittest.main()
