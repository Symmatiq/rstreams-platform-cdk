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
export function createTruncatedName(
  stack: string,
  id: string,
  resourceType: string,
  env: string,
  separator: string = '-'
): string {
  // Truncate required parts
  const truncatedStack = stack.substring(0, 15);
  const truncatedEnv = env.substring(0, 6);
  
  // Calculate remaining characters for ID
  // Format: [env]-[stack]-[id]-[resourceType]
  // Add 3 for the separators (assuming separator is 1 character)
  const usedChars = truncatedEnv.length + truncatedStack.length + resourceType.length + 3 * separator.length;
  const maxIdLength = 64 - usedChars;
  
  // Truncate ID if needed
  const truncatedId = id.length > maxIdLength ? id.substring(0, maxIdLength) : id;
  
  // Construct the name with environment at the beginning
  return [truncatedEnv, truncatedStack, truncatedId, resourceType].join(separator);
} 