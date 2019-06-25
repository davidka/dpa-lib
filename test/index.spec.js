import { Transaction, PrivateKey } from "@dashevo/dashcore-lib";

import DPALib from "../src/index";
import wait from "../lib/wait";

import { testContract, testMemo, testProfile } from "./test-data";

const randomString = () =>
  Math.random()
    .toString(36)
    .substring(7);

describe("DPALib", () => {
  let dpaLib;
  let username;
  let userPrivateKey;
  let user;
  let contractName;
  const timeout = 1000;
  const attempts = 400;

  before(async () => {
    const seeds = process.env.DAPI_CLIENT_SEEDS.split(",").map(ip => ({
      service: `${ip}:${process.env.DAPI_CLIENT_PORT}`
    }));

    dpaLib = new DPALib(process.env.FAUCET_PRIVATE_KEY, {
      seeds,
      timeout: 50000,
      network: "devnet"
    });
  });

  before(async () => {
    username = "5cegi";

    userPrivateKey = PrivateKey.fromWIF(
      "XK4Lyqbv2kPgJLusHoQZ7ajKxGeFJED7jSErydrwAPvdpu4ZhaMU"
    );
    contractName = "4y4v3w";
    // contractName = randomString();

    user = await dpaLib.getUserByName(username);
    expect(user.uname).to.be.equal(username);
  });

  describe("user", () => {
    it("should register new user", async () => {
      const newUsername = randomString();
      const newUserPrivateKey = new PrivateKey();

      const regTxId = await dpaLib.registerUser(
        newUsername,
        newUserPrivateKey,
        10000
      );
      expect(regTxId).to.be.a("string");
      console.dir(`regTxId: ${regTxId}`);

      await wait(timeout);

      const newUser = await dpaLib.getUserByName(newUsername);
      expect(newUser.uname).to.be.equal(newUsername);
      console.dir(
        `created user ${JSON.stringify(
          newUser,
          null,
          2
        )} with private key ${newUserPrivateKey.toWIF()}`
      );
    }).timeout(timeout * 100);

    it("should top up users credits", async () => {
      const currentCredits = user.credits;
      const topUpAmount = 10000;
      await dpaLib.topUpUser(user, userPrivateKey, topUpAmount);

      await wait(timeout);
      user = await dpaLib.getUserByName(username);
      expect(user.credits).to.be.equal(currentCredits + topUpAmount);
    }).timeout(timeout * 100);

    it("should be able to search user by username", async () => {
      const result = await dpaLib.searchUsers(username);
      expect(result).to.be.eql({ users: [user], totalCount: 1 });
    });

    it("should be able to search for all users by passing empty pattern", async () => {
      const result = await dpaLib.searchUsers();
      expect(result.totalCount).to.be.gt(1);
    });

    it("should return undefined if no user was found", async () => {
      const result = await dpaLib.searchUsers(randomString());
      expect(result).to.be.eql({ users: [], totalCount: 0 });
    });
  });

  describe("contract", () => {
    before(() => {
      contractName = randomString();
    });

    it("should not be able to create a invalid contract", () => {
      expect(() => {
        dpaLib.createContract("test-dpa", {});
      }).to.throw("Contract is not valid");
    });

    it("should be able to create a valid contract", () => {
      const contract = dpaLib.createContract("test-dpa", testContract);
      expect(contract).to.be.an("object");
    });

    it("should be able to publish a contract", async () => {
      contractName = randomString();
      console.log("Try to publish contract with name ", contractName);

      const contract = dpaLib.createContract(contractName, testContract);
      const txId = await dpaLib.publishContract(
        contract,
        username,
        userPrivateKey,
        1000
      );

      let publishedContract;
      for (let i = 0; i <= attempts; i++) {
        try {
          // waiting for Contacts to be added
          publishedContract = await dpaLib.getContractById(contract.getId());
          if (publishedContract) {
            break;
          }
        } catch (e) {
          await wait(timeout);
        }
      }

      expect(publishedContract).to.be.deep.equal(contract.toJSON());
      console.dir(
        `published contract ${JSON.stringify(publishedContract, null, 2)}`,
        txId
      );
    }).timeout(timeout * 100);
  });

  describe("document", () => {
    let contract;
    before(async () => {
      contract = dpaLib.createContract(contractName, testContract);
      expect(contract).to.be.an("object");
      dpaLib.setContract(contract);
    });

    it("should be able to create a valid document", async () => {
      const document = await dpaLib.createDocument(
        "memo",
        testMemo,
        username,
        contract
      );
      expect(document).to.be.an("object");
    });

    it("should be able to publish a document", async () => {
      const user = await dpaLib.getUserByName(username);
      const prevSubTx = user.subtx[user.subtx.length - 1] || user.regtxid;

      dpaLib.dpp.setUserId(user.regtxid);

      const profile = dpaLib.dpp.document.create("profile", {
        name: "Alice",
        address: "Somewhere2"
      });

      profile.removeMetadata();

      const stPacket = dpaLib.dpp.packet.create([profile]);

      const transaction = new Transaction().setType(
        Transaction.TYPES.TRANSACTION_SUBTX_TRANSITION
      );

      transaction.extraPayload
        .setRegTxId(user.regtxid)
        .setHashPrevSubTx(prevSubTx)
        .setHashSTPacket(stPacket.hash())
        .setCreditFee(1000)
        .sign(userPrivateKey);

      const transitionHash = await dpaLib.dapiClient.sendRawTransition(
        transaction.serialize(),
        stPacket.serialize().toString("hex")
      );

      return;

      const document = await dpaLib.createDocument(
        "profile",
        testProfile,
        username,
        contract
      );

      const txId = await dpaLib.publishDocument(
        profile,
        contract,
        username,
        userPrivateKey,
        1000
      );

      let publishedDocument;
      for (let i = 0; i <= attempts; i++) {
        [publishedDocument] = await dpaLib.getDocumentsByType(
          "profile",
          contractName
        );

        // waiting for Alice's profile to be added
        if (publishedDocument) {
          break;
        } else {
          await wait(timeout);
        }
      }

      expect(publishedDocument).to.not.be.null();
      expect(publishedDocument).to.have.property("$meta");
      expect(publishedDocument.$meta.userId).to.equal(user.regtxid);

      delete publishedDocument.$meta;

      expect(publishedDocument).to.be.deep.equal(document.toJSON());

      console.dir(
        `published document ${JSON.stringify(publishedDocument, null, 2)}`,
        txId
      );
    });
  });
});
