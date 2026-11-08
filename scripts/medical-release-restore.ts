/** This program prints only trusted release/receipt outcomes, never upstream bodies. */
import {
  restoreMedicalReleaseReceipts,
  verifyMedicalReleaseAdmission,
} from "../src/lib/medical-release-restore";
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--preflight") {
    verifyMedicalReleaseAdmission(process.env);
    console.log("PASS protected fixtures, trusted main history and exact successful pre-deploy CI");
  } else if (args.length === 0) {
    const result = restoreMedicalReleaseReceipts(process.env);
    console.log(JSON.stringify({ check: "signed-synthetic-cleanup-provenance", ...result }));
  } else throw new Error("Unsupported receipt arguments.");
} catch {
  console.error(
    "FAIL medical release admission/provenance; reconcile exact main CI and protected signed receipts.",
  );
  process.exitCode = 1;
}
