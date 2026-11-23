
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress, toEventSelector } from "viem";
import { MerkleTree, type AirdropEntry } from "./merkle.ts";
import { signAirdropClaim } from "./signatures.ts";

const { viem } = await network.connect();

const CLAIMED_EVENT = toEventSelector("Claimed(address,uint256)");

describe("MerkleAirdrop", function () {
  async function deployFixture() {
    const [deployer, alice, bob, carol, signer, dave, eve] =
      await viem.getWalletClients();

    const entries: AirdropEntry[] = [
      { account: getAddress(alice.account.address), amount: parseEther("100") },
      { account: getAddress(bob.account.address), amount: parseEther("200") },
      { account: getAddress(carol.account.address), amount: parseEther("300") },
      { account: getAddress(eve.account.address), amount: parseEther("50") },
    ];

    const tree = new MerkleTree(entries);

    const token = await viem.deployContract("Token", [
      "Redduck Token",
      "RDDK",
      parseEther("100000000000000"),
    ]);

    const airdrop = await viem.deployContract("MerkleAirdrop", [
      token.address,
      tree.root,
      signer.account.address,
    ]);

    await token.write.transfer(
      [airdrop.address, parseEther("100000000000000")],
      { account: deployer.account },
    );

    return {
      entries,
      tree,
      token,
      airdrop,
      deployer,
      alice,
      bob,
      carol,
      signer,
      dave,
      eve,
    };
  }

  it("lets an eligible account claim its allocation with a Merkle proof and emits Claimed", async function () {
    const { entries, tree, token, airdrop, alice } = await deployFixture();
    const publicClient = await viem.getPublicClient();

    const proof = tree.getProof(0);
    const { account, amount } = entries[0];

    const hash = await airdrop.write.claim([amount, proof], {
      account: alice.account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    assert.equal((await token.read.balanceOf([account])) as bigint, amount);
    assert.equal((await airdrop.read.hasClaimed([account])) as boolean, true);

    assert.ok(
      receipt.logs.some((log) => log.topics[0] === CLAIMED_EVENT),
      "Claimed event was not emitted",
    );
  });

  it("lets an authorized account claim with an admin signature and emits Claimed", async function () {
    const { token, airdrop, signer, dave } = await deployFixture();
    const publicClient = await viem.getPublicClient();

    const daveAddr = getAddress(dave.account.address);
    const amount = parseEther("50");

    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      signer,
      daveAddr,
      amount,
      airdrop.address,
      chainId,
    );

    const hash = await airdrop.write.claimWithSignature(
      [amount, v, r, s],
      { account: dave.account },
    );

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    assert.equal((await token.read.balanceOf([daveAddr])) as bigint, amount);
    assert.equal((await airdrop.read.hasClaimed([daveAddr])) as boolean, true);

    assert.ok(
      receipt.logs.some((log) => log.topics[0] === CLAIMED_EVENT),
      "Claimed event was not emitted",
    );
  });

  it("rejects a claim with an invalid Merkle proof", async function () {
    const { airdrop, alice } = await deployFixture();

    await assert.rejects(
      airdrop.write.claim([parseEther("999"), []], {
        account: alice.account,
      }),
    );
  });

  it("prevents an account from claiming twice through Merkle proof", async function () {
    const { airdrop, tree, entries, alice } = await deployFixture();

    const proof = tree.getProof(0);

    await airdrop.write.claim([entries[0].amount, proof], {
      account: alice.account,
    });

    await assert.rejects(
      airdrop.write.claim([entries[0].amount, proof], {
        account: alice.account,
      }),
    );
  });

  it("rejects a signature from an unauthorized signer", async function () {
    const { airdrop, dave, alice } = await deployFixture();
    const amount = parseEther("75");
    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      alice,
      dave.account.address,
      amount,
      airdrop.address,
      chainId,
    );

    await assert.rejects(
      airdrop.write.claimWithSignature([amount, v, r, s], {
        account: dave.account,
      }),
    );
  });

  it("rejects a signature intended for a different recipient", async function () {
    const { airdrop, signer, dave, eve } = await deployFixture();
    const amount = parseEther("75");
    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      signer,
      dave.account.address,
      amount,
      airdrop.address,
      chainId,
    );

    await assert.rejects(
      airdrop.write.claimWithSignature([amount, v, r, s], {
        account: eve.account,
      }),
    );
  });

  it("rejects a signature created for a different contract deployment", async function () {
    const { airdrop, token, signer, dave } = await deployFixture();
    const amount = parseEther("75");
    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      signer,
      dave.account.address,
      amount,
      airdrop.address,
      chainId,
    );

    const merkleRoot = await airdrop.read.merkleRoot();

    const secondAirdrop = await viem.deployContract("MerkleAirdrop", [
      token.address,
      merkleRoot,
      signer.account.address,
    ]);

    await assert.rejects(
      secondAirdrop.write.claimWithSignature([amount, v, r, s], {
        account: dave.account,
      }),
    );
  });

  it("rejects a signature when the claim amount is changed", async function () {
    const { airdrop, signer, dave } = await deployFixture();

    const signedAmount = parseEther("50");
    const changedAmount = parseEther("75");
    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      signer,
      dave.account.address,
      signedAmount,
      airdrop.address,
      chainId,
    );

    await assert.rejects(
      airdrop.write.claimWithSignature(
        [changedAmount, v, r, s],
        { account: dave.account },
      ),
    );

    assert.equal(
      await airdrop.read.hasClaimed([dave.account.address]),
      false,
    );
  });

  it("prevents an account from using the same signature twice", async function () {
    const { airdrop, signer, dave } = await deployFixture();

    const amount = parseEther("50");
    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      signer,
      dave.account.address,
      amount,
      airdrop.address,
      chainId,
    );

    await airdrop.write.claimWithSignature(
      [amount, v, r, s],
      { account: dave.account },
    );

    await assert.rejects(
      airdrop.write.claimWithSignature(
        [amount, v, r, s],
        { account: dave.account },
      ),
    );
  });

  it("prevents claiming through Merkle proof after a signature claim", async function () {
    const { airdrop, tree, entries, signer, alice } = await deployFixture();

    const amount = entries[0].amount;
    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(
      signer,
      alice.account.address,
      amount,
      airdrop.address,
      chainId,
    );

    await airdrop.write.claimWithSignature([amount, v, r, s], {
      account: alice.account,
    });

    await assert.rejects(
      airdrop.write.claim([amount, tree.getProof(0)], {
        account: alice.account,
      }),
    );
  });
});
