export const REVIEW_PROGRAM_PARAMETER = "program";

export function reviewProgramRecipientsAnchorId(programId: string) {
  return `review-program-recipients-${encodeURIComponent(programId)}`;
}

export function reviewProgramHref(publicBaseUrl: string, programId: string) {
  const url = new URL("review/", publicBaseUrl);
  url.searchParams.set(REVIEW_PROGRAM_PARAMETER, programId);
  url.hash = reviewProgramRecipientsAnchorId(programId);
  return url.href;
}
