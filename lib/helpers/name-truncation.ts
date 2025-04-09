/**
 * Creates a truncated resource name that fits within AWS's 64-character limit.
 * Includes a unique hash suffix to prevent naming collisions.
 * 
 * @param stack The stack name (will be truncated to 15 chars)
 * @param id The resource ID
 * @param resourceType Type of resource (e.g., 'Role', 'ApiRole', etc.)
 * @param env Environment name (will be truncated to 6 chars)
 * @param separator Separator character between parts (default: '-')
 * @param forceCase 'lower' | 'upper' | null - Force case of the output (default: null)
 * @returns Truncated resource name string with unique hash suffix
 */
export function createTruncatedName(
  stack: string,
  id: string,
  resourceType: string,
  env: string,
  separator: string = '-',
  forceCase: 'lower' | 'upper' | null = null
): string {
  // Truncate required parts
  const truncatedStack = stack.substring(0, 15);
  const truncatedEnv = env.substring(0, 6);
  
  // Generate a unique hash based on all inputs
  const crypto = require('crypto');
  const hashInput = `${stack}${id}${resourceType}${env}`;
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 8).toUpperCase();
  
  // Calculate remaining characters for ID
  // Format: [env]-[stack]-[id]-[resourceType]-[hash]
  // Add 4 for the separators (assuming separator is 1 character)
  const usedChars = truncatedEnv.length + truncatedStack.length + resourceType.length + hash.length + 4 * separator.length;
  const maxIdLength = 64 - usedChars;
  
  // Truncate ID if needed
  const truncatedId = id.length > maxIdLength ? id.substring(0, maxIdLength) : id;
  
  // Construct the name with environment at the beginning and hash at the end
  let result = [truncatedEnv, truncatedStack, truncatedId, resourceType, hash].join(separator);
  
  // Apply case transformation if requested
  if (forceCase === 'lower') {
    result = result.toLowerCase();
  } else if (forceCase === 'upper') {
    result = result.toUpperCase();
  }
  
  return result;
} 