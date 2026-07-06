// Small dependency-free fuzzy matcher shared by the command palette and the
// vault sidebar. Ranking tiers, highest first:
//   exact match      → 1000
//   prefix match     → 500
//   substring match  → 201–300 (earlier occurrence scores higher)
//   subsequence      → 1–190  (all query chars appear in order)
//   no match         → 0
// Subsequence scores are capped below the substring/prefix/exact tiers so those
// stronger, contiguous matches always rank above loose fuzzy hits.

const WORD_BOUNDARY = new Set([' ', '/', '\\', '-', '_', '.'])

function subsequenceScore(haystack: string, needle: string): number {
  let score = 0
  let cursor = 0
  let run = 0
  let firstMatchIndex = -1

  for (let ni = 0; ni < needle.length; ni += 1) {
    const ch = needle[ni]
    let found = -1
    for (let i = cursor; i < haystack.length; i += 1) {
      if (haystack[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) {
      return 0 // query char missing in order → not a subsequence
    }
    if (firstMatchIndex === -1) {
      firstMatchIndex = found
    }

    if (found === cursor) {
      // Consecutive with the previous match: reward longer runs.
      run += 1
      score += 5 + run * 3
    } else {
      run = 0
      score += 1
    }

    const prev = found > 0 ? haystack[found - 1] : ''
    if (found === 0 || WORD_BOUNDARY.has(prev)) {
      score += 8
    }

    cursor = found + 1
  }

  // Reward matches that begin near the start of the string.
  score += Math.max(0, 20 - firstMatchIndex)

  return Math.min(score, 190)
}

/**
 * Scores how well `text` matches `query`. Returns 0 for no match. Both inputs
 * are compared case-insensitively.
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) {
    return 0
  }
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()

  if (haystack === needle) {
    return 1000
  }
  if (haystack.startsWith(needle)) {
    return 500
  }

  const substringIndex = haystack.indexOf(needle)
  if (substringIndex >= 0) {
    return 300 - Math.min(substringIndex, 99)
  }

  return subsequenceScore(haystack, needle)
}
