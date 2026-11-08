/** Run only with protected synthetic fixture inputs; no real-account fallback. */
import { medicalReleaseConfiguration } from "../src/lib/medical-release-config";
import { MedicalReleaseJourney } from "../src/lib/medical-release-journey";
import { exerciseMedicalRelease } from "../src/lib/medical-release-exercise";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--preflight") {
    medicalReleaseConfiguration(process.env);
    console.log("PASS required protected synthetic credentials, revisions and journal inputs");
  } else if (args.length === 0) {
    await new MedicalReleaseJourney(process.env).run(exerciseMedicalRelease);
  } else throw new Error("Unsupported release arguments.");
}
main().catch(() => {
  console.error(
    "FAIL authenticated medical release gate; inspect its CHECK stage and signed receipts.",
  );
  process.exitCode = 1;
});
