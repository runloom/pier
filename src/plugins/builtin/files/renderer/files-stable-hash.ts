const HASH_MULTIPLIER = 33;
const HASH_MODULUS = 2_147_483_647;
const HASH_SEED = 5381;

export function stableFileIdentityHash(input: string): string {
  let hash = HASH_SEED;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * HASH_MULTIPLIER + input.charCodeAt(index)) % HASH_MODULUS;
  }
  return hash.toString(36);
}
