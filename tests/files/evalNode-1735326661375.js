function evaluate(r) {
  // Extract the words in the output
  // and in the original paragraph
  let outputWords = new Set(r.text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").toLowerCase().split(/\s+/));
  let origTextWords = new Set(r.var["text"].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").toLowerCase().split(/\s+/));
  let count = 0;
  
  // Count number of words the LLM added
  outputWords.forEach(word => {
    if (!origTextWords.has(word)) {
      count++;
    }
  });

  return count;
}