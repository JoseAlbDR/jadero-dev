/**
 * The five boxes of the approval checklist (ADR-031, "Approval checklist", every box required), in
 * the ADR's order:
 * - `noClientNames`: no client or customer names;
 * - `noInternalNames`: no internal system, service or repository names beyond what is already public;
 * - `noNonPublicNumbers`: no non-public numbers;
 * - `noEmployerCode`: no employer code or configuration;
 * - `ownVoice`: wording the owner would use in an interview.
 */
export const APPROVAL_CHECKS = [
  "noClientNames",
  "noInternalNames",
  "noNonPublicNumbers",
  "noEmployerCode",
  "ownVoice",
] as const;

/** One checklist box. */
export type ApprovalCheck = (typeof APPROVAL_CHECKS)[number];

/** The owner's answer to every box, recorded with the approval. */
export type ApprovalChecklist = Readonly<Record<ApprovalCheck, boolean>>;

/**
 * The boxes not ticked. Anything other than `true` counts as unticked, so a missing key in an
 * unchecked object (an importer's partial answer) never passes.
 * @param checklist the answers.
 * @returns the unticked boxes in the ADR's order, empty when the approval may go ahead.
 */
export function uncheckedBoxes(checklist: ApprovalChecklist): ApprovalCheck[] {
  return APPROVAL_CHECKS.filter((check) => checklist[check] !== true);
}
