function evaluate(r) {
  // Extract the words in the output
  // and in the original paragraph
  let outputWords = r.text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").toLowerCase().split(/\s+/);
  let origTextWords = r.var["text"].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").toLowerCase().split(/\s+/);
  
  // Return the number of deleted words
  const wordsDeleted = origTextWords.length - outputWords.length;
  return wordsDeleted;
}