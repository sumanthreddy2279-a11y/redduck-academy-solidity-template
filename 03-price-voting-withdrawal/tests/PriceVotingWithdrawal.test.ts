
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const ONE_DAY = 60 * 60 * 24;

describe("PriceVotingWithdrawal", function () {
  async function deployFixture() {
    const [deployer, alice, bob, carol] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", [
      "Vote Token",
      "VOTE",
      parseEther("1000000"),
    ]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + ONE_DAY);

    const voting = await viem.deployContract("PriceVotingWithdrawal", [
      token.address,
      votingEnd,
    ]);

    for (const w of [alice, bob, carol]) {
      await token.write.transfer(
        [w.account.address, parseEther("1000")],
        { account: deployer.account }
      );

      await token.write.approve(
        [voting.address, parseEther("1000")],
        { account: w.account }
      );
    }

    return { token, voting, votingEnd, deployer, alice, bob, carol };
  }

  it("deploys correctly", async function () {
    const { voting, token, votingEnd } =
      await networkHelpers.loadFixture(deployFixture);

    assert.equal(
      (await voting.read.token()).toLowerCase(),
      token.address.toLowerCase()
    );

    assert.equal(await voting.read.votingEnd(), votingEnd);
    assert.equal(await voting.read.finalized(), false);
    assert.equal(await voting.read.MAX_PRICES(), 100n);
  });

  it("allows a voter to vote", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    assert.equal(
      await voting.read.weightOf([100n]),
      parseEther("100")
    );

    assert.equal(
      await voting.read.lockedOf([alice.account.address, 100n]),
      parseEther("100")
    );
  });

  it("allows multiple votes for the same price", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.vote(
      [100n, parseEther("50")],
      { account: alice.account }
    );

    assert.equal(
      await voting.read.weightOf([100n]),
      parseEther("150")
    );
  });

  it("allows voting for different prices", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.vote(
      [200n, parseEther("50")],
      { account: alice.account }
    );

    assert.equal(
      await voting.read.weightOf([100n]),
      parseEther("100")
    );

    assert.equal(
      await voting.read.weightOf([200n]),
      parseEther("50")
    );
  });

  it("allows withdrawal during voting", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.withdraw(
      [100n, parseEther("40")],
      { account: alice.account }
    );

    assert.equal(
      await voting.read.weightOf([100n]),
      parseEther("60")
    );

    assert.equal(
      await voting.read.lockedOf([alice.account.address, 100n]),
      parseEther("60")
    );
  });

  it("returns withdrawn tokens to the voter", async function () {
    const { voting, token, alice } =
      await networkHelpers.loadFixture(deployFixture);

    const before = await token.read.balanceOf([alice.account.address]);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.withdraw(
      [100n, parseEther("40")],
      { account: alice.account }
    );

    const after = await token.read.balanceOf([alice.account.address]);

    assert.equal(after, before - parseEther("60"));
  });

  it("allows a voter to withdraw all locked tokens", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.withdraw(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    assert.equal(await voting.read.weightOf([100n]), 0n);

    assert.equal(
      await voting.read.lockedOf([alice.account.address, 100n]),
      0n
    );
  });

  it("does not allow withdrawing more than locked", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("50")],
      { account: alice.account }
    );

    await assert.rejects(
      voting.write.withdraw(
        [100n, parseEther("60")],
        { account: alice.account }
      )
    );
  });

  it("allows voting again after withdrawal", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.withdraw(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.vote(
      [200n, parseEther("100")],
      { account: alice.account }
    );

    assert.equal(await voting.read.weightOf([100n]), 0n);

    assert.equal(
      await voting.read.weightOf([200n]),
      parseEther("100")
    );
  });

  it("does not allow zero-amount votes", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await assert.rejects(
      voting.write.vote([100n, 0n], { account: alice.account })
    );
  });

  it("does not allow zero-amount withdrawals", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await assert.rejects(
      voting.write.withdraw([100n, 0n], { account: alice.account })
    );
  });

  it("does not allow voting after the voting period ends", async function () {
    const { voting, votingEnd, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await networkHelpers.time.increaseTo(votingEnd);

    await assert.rejects(
      voting.write.vote(
        [100n, parseEther("100")],
        { account: alice.account }
      )
    );
  });

  it("allows withdrawal after voting ends", async function () {
    const { voting, votingEnd, alice } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await networkHelpers.time.increaseTo(votingEnd);

    await voting.write.withdraw(
      [100n, parseEther("40")],
      { account: alice.account }
    );

    assert.equal(
      await voting.read.weightOf([100n]),
      parseEther("60")
    );
  });

  it("does not allow finalization before voting ends", async function () {
    const { voting } =
      await networkHelpers.loadFixture(deployFixture);

    await assert.rejects(voting.write.finalize());
  });

  it("selects the price with the highest remaining weight", async function () {
    const { voting, alice, bob } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.vote(
      [200n, parseEther("150")],
      { account: bob.account }
    );

    await voting.write.withdraw(
      [200n, parseEther("100")],
      { account: bob.account }
    );

    await networkHelpers.time.increaseTo(
      await voting.read.votingEnd()
    );

    await voting.write.finalize();

    const result = await voting.read.winner();

    assert.equal(result[0], 100n);
    assert.equal(result[1], parseEther("100"));
  });

  it("does not count fully withdrawn votes", async function () {
    const { voting, alice, bob } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("200")],
      { account: alice.account }
    );

    await voting.write.vote(
      [200n, parseEther("100")],
      { account: bob.account }
    );

    await voting.write.withdraw(
      [100n, parseEther("200")],
      { account: alice.account }
    );

    await networkHelpers.time.increaseTo(
      await voting.read.votingEnd()
    );

    await voting.write.finalize();

    const result = await voting.read.winner();

    assert.equal(result[0], 200n);
    assert.equal(result[1], parseEther("100"));
  });

  it("keeps the first price when weights are tied", async function () {
    const { voting, alice, bob } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.vote(
      [200n, parseEther("100")],
      { account: bob.account }
    );

    await networkHelpers.time.increaseTo(
      await voting.read.votingEnd()
    );

    await voting.write.finalize();

    const result = await voting.read.winner();

    assert.equal(result[0], 100n);
    assert.equal(result[1], parseEther("100"));
  });

  it("returns zero when nobody votes", async function () {
    const { voting, votingEnd } =
      await networkHelpers.loadFixture(deployFixture);

    await networkHelpers.time.increaseTo(votingEnd);
    await voting.write.finalize();

    const result = await voting.read.winner();

    assert.equal(result[0], 0n);
    assert.equal(result[1], 0n);
  });

  it("does not allow finalization twice", async function () {
    const { voting, votingEnd } =
      await networkHelpers.loadFixture(deployFixture);

    await networkHelpers.time.increaseTo(votingEnd);
    await voting.write.finalize();

    await assert.rejects(voting.write.finalize());
  });

  it("does not change the winner after finalization", async function () {
    const { voting, votingEnd, alice, bob } =
      await networkHelpers.loadFixture(deployFixture);

    await voting.write.vote(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    await voting.write.vote(
      [200n, parseEther("50")],
      { account: bob.account }
    );

    await networkHelpers.time.increaseTo(votingEnd);
    await voting.write.finalize();

    const before = await voting.read.winner();

    await voting.write.withdraw(
      [100n, parseEther("100")],
      { account: alice.account }
    );

    const after = await voting.read.winner();

    assert.deepEqual(after, before);
  });

  // Scalability tests

  it("allows voting on 100 distinct prices", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    for (let price = 1; price <= 100; price++) {
      await voting.write.vote(
        [BigInt(price), parseEther("1")],
        { account: alice.account }
      );
    }

    assert.equal(
      await voting.read.weightOf([100n]),
      parseEther("1")
    );
  });

  it("rejects a 101st distinct price", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    for (let price = 1; price <= 100; price++) {
      await voting.write.vote(
        [BigInt(price), parseEther("1")],
        { account: alice.account }
      );
    }

    await assert.rejects(
      voting.write.vote(
        [101n, parseEther("1")],
        { account: alice.account }
      )
    );
  });

  it("allows additional votes for existing prices after reaching the limit", async function () {
    const { voting, alice } =
      await networkHelpers.loadFixture(deployFixture);

    for (let price = 1; price <= 100; price++) {
      await voting.write.vote(
        [BigInt(price), parseEther("1")],
        { account: alice.account }
      );
    }

    await voting.write.vote(
      [1n, parseEther("5")],
      { account: alice.account }
    );

    assert.equal(
      await voting.read.weightOf([1n]),
      parseEther("6")
    );
  });

  it("selects the correct winner among 100 distinct prices", async function () {
    const { voting, alice, votingEnd } =
      await networkHelpers.loadFixture(deployFixture);

    for (let price = 1; price <= 100; price++) {
      await voting.write.vote(
        [
          BigInt(price),
          parseEther(price === 50 ? "10" : "1"),
        ],
        { account: alice.account }
      );
    }

    await networkHelpers.time.increaseTo(votingEnd);
    await voting.write.finalize();

    const result = await voting.read.winner();

    assert.equal(result[0], 50n);
    assert.equal(result[1], parseEther("10"));
  });
});
