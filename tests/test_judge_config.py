import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

from judge_config import (
    apply_challenge_overrides,
    effective_tolerances,
    load_float32_matmul_precisions,
    load_judge_overrides,
    read_judge_config,
    save_judge_config,
    validate_judge_config,
)


class JudgeConfigTests(unittest.TestCase):
    def test_matrix_multiplication_uses_local_tolerances(self):
        self.assertEqual(
            effective_tolerances("2_matrix_multiplication", 1e-4, 1e-4),
            (5e-4, 1e-4),
        )

    def test_other_challenges_keep_upstream_tolerances(self):
        self.assertEqual(
            effective_tolerances("1_vector_add", 1e-5, 1e-6),
            (1e-5, 1e-6),
        )

    def test_config_only_contains_supported_tolerance_fields(self):
        self.assertEqual(
            set(load_judge_overrides()["2_matrix_multiplication"]),
            {"atol", "rtol"},
        )

    def test_matrix_multiplication_reference_uses_highest_precision_policy(self):
        class Challenge:
            atol = 1e-4
            rtol = 1e-4

            def reference_impl(self):
                return torch.get_float32_matmul_precision()

        previous = torch.get_float32_matmul_precision()
        challenge = apply_challenge_overrides("2_matrix_multiplication", Challenge())
        self.assertEqual(challenge.reference_impl(), "highest")
        self.assertEqual(torch.get_float32_matmul_precision(), previous)

    def test_precision_config_is_scoped_to_matrix_multiplication(self):
        self.assertEqual(
            load_float32_matmul_precisions(),
            {"2_matrix_multiplication": "highest"},
        )

    def test_config_changes_are_reloaded_without_restarting(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "judge_overrides.json"
            config_path.write_text(
                json.dumps(
                    {"tolerances": {"2_matrix_multiplication": {"atol": 0.1}}}
                ),
                encoding="utf-8",
            )
            with patch("judge_config.CONFIG_PATH", config_path):
                self.assertEqual(
                    effective_tolerances("2_matrix_multiplication", 1e-4, 1e-4),
                    (0.1, 1e-4),
                )
                config_path.write_text(
                    json.dumps(
                        {"tolerances": {"2_matrix_multiplication": {"atol": 0.2}}}
                    ),
                    encoding="utf-8",
                )
                self.assertEqual(
                    effective_tolerances("2_matrix_multiplication", 1e-4, 1e-4),
                    (0.2, 1e-4),
                )

    def test_validation_rejects_unknown_and_invalid_values(self):
        with self.assertRaisesRegex(ValueError, "未知字段"):
            validate_judge_config({"unexpected": {}})
        with self.assertRaisesRegex(ValueError, "有限的非负数"):
            validate_judge_config({"tolerances": {"1_vector_add": {"atol": -1}}})
        with self.assertRaisesRegex(ValueError, "FP32 matmul"):
            validate_judge_config({"float32MatmulPrecision": {"1_vector_add": "fast"}})

    def test_save_is_validated_and_immediately_reloaded(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "judge_overrides.json"
            with patch("judge_config.CONFIG_PATH", config_path):
                saved = save_judge_config({
                    "tolerances": {"1_vector_add": {"atol": 0.25}},
                    "float32MatmulPrecision": {"1_vector_add": "high"},
                })
                self.assertEqual(read_judge_config(), saved)
                self.assertEqual(effective_tolerances("1_vector_add", 1e-5, 1e-6), (0.25, 1e-6))
                self.assertFalse(any(config_path.parent.glob(".judge_overrides.json.*.tmp")))


if __name__ == "__main__":
    unittest.main()
