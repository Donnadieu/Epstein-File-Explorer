export function getClientId(): string {
  let id = localStorage.getItem("epstein_client_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("epstein_client_id", id);
  }
  return id;
}
