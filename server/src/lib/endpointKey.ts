export interface EndpointLike {
  host: string;
  port: number;
  mount: string;
  ssl?: boolean;
}

export function endpointKey(endpoint: EndpointLike): string {
  const scheme = endpoint.ssl ? 'https' : 'http';
  const host = endpoint.host.trim().toLowerCase();
  const port = endpoint.port || (endpoint.ssl ? 443 : 80);
  const mount = endpoint.mount.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return `${scheme}://${host}:${port}/${mount}`;
}
