export const REVIEW_PROGRAM_PARAMETER = "program";

export function reviewProgramAnchorId(programId: string) {
  return `review-program-${encodeURIComponent(programId)}`;
}

export function reviewProgramHref(publicBaseUrl: string, programId: string) {
  const url = new URL("review/", publicBaseUrl);
  url.searchParams.set(REVIEW_PROGRAM_PARAMETER, programId);
  url.hash = reviewProgramAnchorId(programId);
  return url.href;
}
