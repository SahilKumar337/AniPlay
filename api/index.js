import { handleRequest } from '../server/proxy.mjs';

export default async function handler(req, res) {
  // Pass the request to the AniLab proxy stream engine
  return handleRequest(req, res);
}
