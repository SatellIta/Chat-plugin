//Powered by Cluade
export const split = (responseText) => {
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function trimSpecificMarker(str, marker) {
    if (typeof str !== 'string' || typeof marker !== 'string' || !marker) {
      return str;
    }
    let trimmedStr = str.trim();
    const escapedMarker = escapeRegex(marker);
    const regex = new RegExp(`^${escapedMarker}|${escapedMarker}$`, 'g');
    return trimmedStr.replace(regex, '').trim();
  }

  function filterResponseChunk(msg) {
    if (typeof msg !== 'string') {
      return false;
    }
    let trimmedMsg = msg.trim();
    if (!trimmedMsg) {
      return false;
    }
    if (trimmedMsg === '```' || trimmedMsg === '<EMPTY>') {
      return false;
    }
    trimmedMsg = trimSpecificMarker(trimmedMsg, '<EMPTY>');
    return trimmedMsg.length > 0 ? trimmedMsg : false;
  }

  if (!responseText || typeof responseText !== 'string') {
    return [];
  }

  const MAX_LENGTH = 250;
  if (responseText.length > MAX_LENGTH) {
    return [responseText];
  }

  const splitRegex = /(?<!\?)[。？\n](?!\?)/g;
  const rawChunks = [];
  let lastSplitIndex = 0;
  let match;

  while ((match = splitRegex.exec(responseText)) !== null) {
    rawChunks.push(responseText.slice(lastSplitIndex, match.index));
    lastSplitIndex = splitRegex.lastIndex;
  }
  rawChunks.push(responseText.slice(lastSplitIndex));

  const finalResultChunks = [];
  let currentSearchIndex = 0;

  for (const rawChunk of rawChunks) {
    let processedChunk = rawChunk.trim();
    let chunkEndIndexInOriginal = currentSearchIndex + rawChunk.length;

    if (processedChunk && chunkEndIndexInOriginal < responseText.length && responseText[chunkEndIndexInOriginal] === '？') {
      processedChunk += '？';
    }

    const finalChunk = filterResponseChunk(processedChunk);
    if (finalChunk !== false) {
      finalResultChunks.push(finalChunk);
    }

    currentSearchIndex = chunkEndIndexInOriginal + 1;
    if (currentSearchIndex > responseText.length) {
      currentSearchIndex = responseText.length;
    }
  }

  if (finalResultChunks.length > 3) {
    return [responseText];
  }

  return finalResultChunks;
}