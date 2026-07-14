export const FILE_PREVIEW_SCHEME = "pier-file-preview";

const FILE_PREVIEW_TICKET_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;

export function filePreviewUrlForTicket(ticket: string): string {
  if (!FILE_PREVIEW_TICKET_PATTERN.test(ticket)) {
    throw new Error("Invalid file preview ticket");
  }
  return `${FILE_PREVIEW_SCHEME}://file/${ticket}`;
}

export function filePreviewTicketFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${FILE_PREVIEW_SCHEME}:` ||
      url.hostname !== "file" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const ticket = url.pathname.slice(1);
    return !ticket.includes("/") && FILE_PREVIEW_TICKET_PATTERN.test(ticket)
      ? ticket
      : null;
  } catch {
    return null;
  }
}
