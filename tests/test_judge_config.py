import unittest

from judge_config import effective_tolerances, load_judge_overrides


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


if __name__ == "__main__":
    unittest.main()
