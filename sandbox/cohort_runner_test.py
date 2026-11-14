import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cohort_runner


class HungProcess:
    returncode = None
    killed = False

    def communicate(self, timeout=None):
        if self.killed:
            return "", ""
        raise cohort_runner.subprocess.TimeoutExpired("fake search", timeout)

    def kill(self):
        self.killed = True
        self.returncode = -9


class CohortDeadlineTest(unittest.TestCase):
    def test_local_hung_patient_is_failed_at_the_deadline(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td)
            (folder / "p1.json").write_text(json.dumps({"minutes": [], "practices": []}), encoding="utf-8")
            board = cohort_runner.Board(1, "local")
            old = cohort_runner.DEADLINE
            cohort_runner.DEADLINE = 0.01
            try:
                with patch.object(cohort_runner.subprocess, "Popen", return_value=HungProcess()):
                    cohort_runner.run_local(board, folder, folder)
            finally:
                cohort_runner.DEADLINE = old
            self.assertEqual(board.snapshot()["patients"][0]["state"], "failed")
            self.assertIn("took longer than", board.errors[0])


if __name__ == "__main__":
    unittest.main()
