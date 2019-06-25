export default class DPALibError extends Error {
  constructor(message) {
    super(message);
    this.message = evaluateErrorMessage(message);
  }
}

const evaluateErrorMessage = message => {
  if (message.message && message.message.search("bad-subtx-lowtopup") > -1) {
    return "Please choose higher funding amount";
  }

  return message;
};
