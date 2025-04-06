/**
 * Creates a truncated resource name that fits within AWS's 64-character limit.
 *
 * @param stack The stack name (will be truncated to 15 chars)
 * @param id The resource ID
 * @param resourceType Type of resource (e.g., 'Role', 'ApiRole', etc.)
 * @param env Environment name (will be truncated to 6 chars)
 * @param separator Separator character between parts (default: '-')
 * @returns Truncated resource name string
 */
export declare function createTruncatedName(stack: string, id: string, resourceType: string, env: string, separator?: string): string;
