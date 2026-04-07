'use strict';

// Returns a new shuffled copy of the array (Fisher-Yates).
// Does NOT mutate the original array or modify Array.prototype.
function shuffle(arr) {
  const result = arr.slice();
  let len = result.length;
  while (len) {
    const i = Math.random() * len-- >>> 0;
    const temp = result[len];
    result[len] = result[i];
    result[i] = temp;
  }
  return result;
}

module.exports = shuffle;
