"""Unity runner for the `native` env that also enforces coverage.

All host tests live in one suite (test/test_host) so a single build
produces the coverage data. After the tests run, gcovr measures line coverage of the
hardware-independent libraries only (main.cpp, BLE, WiFi, SD and OTA cannot
run on the host and are deliberately excluded), and the run fails below
COVERAGE_MIN_PERCENT.
"""

import os
import platform
import shutil
import subprocess

from platformio.test.result import TestCase, TestStatus
from platformio.test.runners.unity import UnityTestRunner

COVERAGE_MIN_PERCENT = 70
MEASURED_SOURCES = [
    "lib/BoilerController/src/",
    "lib/BoilerCommand/src/",
]


class CustomTestRunner(UnityTestRunner):
    def stage_testing(self):
        if self.options.without_testing:
            return super().stage_testing()
        # gcov accumulates counts across runs and incremental builds keep
        # unchanged objects, so clear old data to measure this run alone.
        for root, _, files in os.walk(self._build_dir()):
            for name in files:
                if name.endswith(".gcda"):
                    os.remove(os.path.join(root, name))
        result = super().stage_testing()
        self._check_coverage()
        return result

    def _project_dir(self):
        return os.path.dirname(self.project_config.path)

    def _build_dir(self):
        return os.path.join(self._project_dir(), ".pio", "build", self.test_suite.env_name)

    def _check_coverage(self):
        project_dir = self._project_dir()
        build_dir = self._build_dir()

        gcovr = shutil.which("gcovr")
        if gcovr is None:
            self._fail("gcovr not found: pip install -r embedded/esp32/requirements.txt")
            return

        cmd = [gcovr, "--root", project_dir, "--object-directory", build_dir]
        for src in MEASURED_SOURCES:
            cmd += ["--filter", os.path.join(project_dir, src)]
        if platform.system() == "Darwin":
            # Apple's toolchain is clang; its .gcda files need llvm-cov.
            cmd += ["--gcov-executable", "xcrun llvm-cov gcov"]
        cmd += ["--txt", "--fail-under-line", str(COVERAGE_MIN_PERCENT)]

        proc = subprocess.run(cmd, cwd=project_dir, check=False)
        if proc.returncode != 0:
            self._fail(
                f"Line coverage of {', '.join(MEASURED_SOURCES)} is below "
                f"{COVERAGE_MIN_PERCENT}% (or gcovr failed); see report above"
            )

    def _fail(self, message):
        self.test_suite.add_case(
            TestCase(
                name=f"{self.test_suite.env_name}:coverage",
                status=TestStatus.FAILED,
                message=message,
            )
        )
