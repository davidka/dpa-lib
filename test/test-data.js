export const testContract = {
  profile: {
    indices: [{ properties: [{ $userId: "asc" }], unique: true }],
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: 144
      },
      address: {
        type: "string"
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: 144
      },
      avatarUrl: {
        type: "string",
        format: "uri"
      }
    },
    required: ["name", "address"],
    additionalProperties: false
  },
  memo: {
    properties: {
      message: {
        type: "string",
        minLength: 1,
        maxLength: 144
      },
      createdAt: {
        type: "string",
        format: "date-time"
      },
      updateAt: {
        type: "string",
        format: "date-time"
      }
    },
    required: ["message", "createdAt"],
    additionalProperties: false
  }
};

export const testMemo = {
  message: "Hello World!",
  createdAt: new Date().toJSON()
};

export const testProfile = {
  name: "Alice",
  address: "Somewhere"
};
