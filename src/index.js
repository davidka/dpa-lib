import DAPIClient from "@dashevo/dapi-client";
import {
  Transaction,
  PrivateKey,
  PublicKey,
  Address
} from "@dashevo/dashcore-lib";
import DashPlatformProtocol from "@dashevo/dpp";
import DPALibError from "./dpa-lib-error";

export default class DPALib {
  /**
   * @param {string} faucetPrivateKey - Private key of the faucet
   *
   * @param options
   * @param {Array<Object>} [options.seeds] - seeds
   * @param {string} [options.contractName] - name of the published Contract
   * @param {object} [options.contract] - contract
   * @param {number} [options.timeout=2000] - timeout for connection to the DAPI
   * @param {string} [options.network=testnet] - Type of the network to connect to
   */
  constructor(faucetPrivateKey, options = {}) {
    const { seeds, contractName, contract, timeout } = options;
    this.dapiClient = new DAPIClient({ seeds, timeout });
    this.dpp = new DashPlatformProtocol();

    if (contractName && contract) {
      this.dpp.setContract(this.createContract(contractName, contract));
    }

    this.faucetPrivateKey = faucetPrivateKey;
    const faucetPublicKey = PublicKey.fromPrivateKey(
      new PrivateKey(faucetPrivateKey)
    );

    this.network =
      !options.network || options.network === "devnet"
        ? "testnet"
        : options.network;

    this.faucetAddress = Address.fromPublicKey(
      faucetPublicKey,
      this.network
    ).toString();
  }

  setContract(contract) {
    this.dpp.setContract(contract);
  }

  // async init() {
  //   if (this.contractId) {
  //     try {
  //       const contract = await this.getContractById(this.contractId);
  //       this.dpp.setContract(contract);
  //     } catch (e) {
  //       throw new DPALibError(
  //         `Could not fetch contract with id ${this.contractId} \n ${e}`
  //       );
  //     }
  //   }
  // }
  /**
   * @param username
   * @param privateKey
   * @param fundingAmount
   * @returns {Promise<string>} regTxId - transaction id
   */
  async registerUser(username, privateKey, fundingAmount = 10000) {
    try {
      const userPrivateKey = new PrivateKey(privateKey);
      const validPayload = new Transaction.Payload.SubTxRegisterPayload()
        .setUserName(username)
        .setPubKeyIdFromPrivateKey(userPrivateKey)
        .sign(userPrivateKey);

      const { items: inputs } = await this.dapiClient.getUTXO(
        this.faucetAddress
      );

      const transaction = Transaction()
        .setType(Transaction.TYPES.TRANSACTION_SUBTX_REGISTER)
        .setExtraPayload(validPayload)
        .from(inputs.slice(-1)[0])
        .addFundingOutput(fundingAmount)
        .change(this.faucetAddress)
        .sign(this.faucetPrivateKey);

      const txId = await this.dapiClient.sendRawTransaction(
        transaction.serialize()
      );

      if (this.network === "testnet") {
        await this.dapiClient.generate(1);
      }

      return txId;
    } catch (e) {
      console.dir(e);
      throw new DPALibError(e);
    }
  }

  async topUpUser(user, privateKey, topUpAmount) {
    try {
      const validPayload = new Transaction.Payload.SubTxTopupPayload()
        .setRegTxHash(user.regtxid)
        .sign(new PrivateKey(privateKey));

      const { items: inputs } = await this.dapiClient.getUTXO(
        this.faucetAddress
      );

      const transaction = Transaction()
        .setType(Transaction.TYPES.TRANSACTION_SUBTX_TOPUP)
        .setExtraPayload(validPayload)
        .from(inputs.slice(-1)[0])
        .addFundingOutput(topUpAmount)
        .change(this.faucetAddress)
        .sign(this.faucetPrivateKey);

      const txId = await this.dapiClient.sendRawTransaction(
        transaction.serialize()
      );

      if (this.network === "testnet") {
        await this.dapiClient.generate(1);
      }

      return txId;
    } catch (e) {
      console.dir(e);
      throw new DPALibError(e);
    }
  }

  async getUserByName(username) {
    return await this.dapiClient.getUserByName(username);
  }

  async createDocument(type, data, username, contract) {
    const user = await this.getUserByName(username);
    this.dpp.setUserId(user.regtxid);
    // this.dpp.setContract(contract);

    let document;
    document = this.dpp.document.create(type, data);
    const result = this.dpp.document.validate(document);

    if (!result.isValid()) {
      throw new DPALibError(`Document is not valid: ${result.getErrors()}`);
    }
    return document;
  }

  async publishDocument(
    document,
    contract,
    username,
    privateKey,
    creditFee = 1000
  ) {
    // this.dpp.setContract(contract);
    return await this._sendTransaction(
      [document],
      username,
      privateKey,
      creditFee
    );
  }

  createContract(contractName, documents) {
    const contract = this.dpp.contract.create(contractName, documents);
    const result = this.dpp.contract.validate(contract);

    if (!result.isValid()) {
      throw new DPALibError(`Contract is not valid. \n ${result.getErrors()}`);
    }

    return contract;
  }

  async getDocumentsByType(type) {
    return await this.dapiClient.fetchDocuments(
      this.dpp.getContract().getId(),
      type,
      {
        where: {}
      }
    );
  }

  async publishContract(contract, username, privateKey, creditFee = 1000) {
    this.dpp.setContract(contract);
    return await this._sendTransaction(
      contract,
      username,
      privateKey,
      creditFee
    );
  }

  async getContractById(contractId) {
    return await this.dapiClient.fetchContract(contractId);
  }

  async _sendTransaction(items, username, privateKey, creditFee) {
    // 1. Create ST packet
    const stPacket = this.dpp.packet.create(items);

    // 2. Create State Transition
    const transaction = new Transaction().setType(
      Transaction.TYPES.TRANSACTION_SUBTX_TRANSITION
    );

    const user = await this.getUserByName(username);
    const prevSubTx = user.subtx[user.subtx.length - 1] || user.regtxid;

    transaction.extraPayload
      .setRegTxId(user.regtxid)
      .setHashPrevSubTx(prevSubTx)
      .setHashSTPacket(stPacket.hash())
      .setCreditFee(creditFee)
      .sign(privateKey);

    const txId = await this.dapiClient.sendRawTransition(
      transaction.serialize(),
      stPacket.serialize().toString("hex")
    );

    if (this.network === "testnet") {
      // 3. Mine block with ST
      await this.dapiClient.generate(1);
    }

    return txId;
  }

  /**
   * Returns blockchain user found by pattern
   * @param pattern=""
   * @param limit
   * @param offset
   * @returns {Promise<{totalCount: number, users: Array}>}
   */
  async searchUsers(pattern = "", limit, offset) {
    const searchResult = await this.dapiClient.searchUsers(
      pattern,
      limit,
      offset
    );

    let users = [];
    if (searchResult.totalCount > 0) {
      const getUserPromises = [];
      for (const username of searchResult.results) {
        getUserPromises.push(this.getUserByName(username));
      }

      users = await Promise.all(getUserPromises);
    }

    return { users, totalCount: searchResult.totalCount };
  }
}
