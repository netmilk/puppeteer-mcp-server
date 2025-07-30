# Fix Chrome Debug Port Connection Issues

## Issue
The MCP server failed to connect to Chrome's remote debugging port due to IPv6/IPv4 resolution conflicts. When `localhost` resolves to both IPv4 and IPv6 addresses, some systems attempt IPv6 first (`::1:9222`) while Chrome's `--remote-debugging-port` typically binds to IPv4 only (`127.0.0.1:9222`), causing `ECONNREFUSED` errors.

## Solution
- Implemented connection fallback: try IPv4 first (127.0.0.1), then localhost
- Added 1-second timeout per connection attempt to avoid delays
- Added `node-fetch` dependency as implementation detail for Node.js v18 compatibility

## Changes
- `src/browser/connection.ts`: Added `tryFetch` helper and connection fallback logic  
- `package.json`: Added `node-fetch` and `@types/node-fetch` dependencies with consistent indenting

## Testing
Verified connection works on macOS with Chrome running `--remote-debugging-port=9222`

The fix maintains backward compatibility while supporting both IPv4 and IPv6 configurations.