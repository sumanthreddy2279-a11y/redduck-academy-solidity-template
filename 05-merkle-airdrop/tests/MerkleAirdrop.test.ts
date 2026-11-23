import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, getAddress } from "viem";
import { MerkleTree, type AirdropEntry } from "./merkle.ts";
import { signAirdropClaim } from "./signatures.ts";

const { viem } = await network.connect();

// Two starter happy-path tests: one claim via the Merkle proof, one via an admin
// signature. Both fail until the contract and the matching off-chain code
// (merkle.ts, signatures.ts) are implemented. Add tests for the failure modes
// described in TASK.md (bad proofs, wrong signer/amount/recipient, replay across
// both paths via the shared hasClaimed).
describe("MerkleAirdrop", function () {
  async function deployFixture() {
    const [deployer, alice, bob, carol, signer, dave, eve] = await viem.getWalletClients();

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

    await token.write.transfer([airdrop.address, parseEther("100000000000000")], {
      account: deployer.account,
    });

    return { entries, tree, token, airdrop, deployer, alice, bob, carol, signer, dave, eve };
  }

  it("lets an eligible account claim its allocation with a Merkle proof", async function () {
    const { entries, tree, token, airdrop, alice } = await deployFixture();

    const proof = tree.getProof(0);
    const { account, amount } = entries[0];

    await airdrop.write.claim([amount, proof], { account: alice.account });

    assert.equal((await token.read.balanceOf([account])) as bigint, amount);
    assert.equal((await airdrop.read.hasClaimed([account])) as boolean, true);
  });

  it("lets an authorized account claim with an admin signature (not on the Merkle list)", async function () {
    const { token, airdrop, signer, dave } = await deployFixture();

    const daveAddr = getAddress(dave.account.address);
    const amount = parseEther("50");

    const chainId = (await network.connect()).networkConfig.chainId;

    const { v, r, s } = await signAirdropClaim(signer, daveAddr, amount, airdrop.address, chainId);
    await airdrop.write.claimWithSignature([amount, v, r, s], { account: dave.account });

    assert.equal((await token.read.balanceOf([daveAddr])) as bigint, amount);
    assert.equal((await airdrop.read.hasClaimed([daveAddr])) as boolean, true);
  });

  it("rejects a claim with an invalid Merkle proof", async function () {
    const { airdrop, alice } = await deployFixture();

    await assert.rejects(
      airdrop.write.claim([parseEther("999"), []], {
        account: alice.account,
      }),
    );
  });

  it("prevents an account from claiming twice", async function () {
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

    // Claim using the admin signature.
    await airdrop.write.claimWithSignature([amount, v, r, s], {
      account: alice.account,
    });

    // Attempt to claim again using the Merkle proof.
    await assert.rejects(
      airdrop.write.claim([amount, tree.getProof(0)], {
        account: alice.account,
      }),
    );
  });
});
