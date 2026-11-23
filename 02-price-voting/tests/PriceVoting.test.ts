
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, decodeEventLog, getAddress } from "viem";

const { viem, networkHelpers } = await network.connect();

const ONE_DAY = 60 * 60 * 24;

describe("PriceVoting", function () {
  async function deployVotingFixture() {
    const [deployer, alice, bob, carol] = await viem.getWalletClients();

    const token = await viem.deployContract("Token", [
      "Vote Token",
      "VOTE",
      parseEther("1000000"),
    ]);

    const now = await networkHelpers.time.latest();
    const votingEnd = BigInt(now + ONE_DAY);

    const voting = await viem.deployContract("PriceVoting", [
      token.address,
      votingEnd,
    ]);

    for (const w of [alice, bob, carol]) {
      await token.write.transfer(
        [w.account.address, parseEther("1000")]
      );

      await token.write.approve(
        [voting.address, parseEther("1000")],
        { account: w.account }
      );
    }

    return { token, voting, votingEnd, deployer, alice, bob, carol };
  }

  async function endVoting(votingEnd: bigint) {
    await networkHelpers.time.increaseTo(votingEnd);
  }

  describe("vote", function () {
    it("1. records a single vote and updates the leader", async function () {
      const { voting, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      assert.equal(await voting.read.weightOf([100n]), parseEther("50"));
      assert.equal(
        await voting.read.lockedOf([alice.account.address]),
        parseEther("50")
      );

      const [price, weight] = await voting.read.leader();

      assert.equal(price, 100n);
      assert.equal(weight, parseEther("50"));
    });

    it("2. emits Voted", async function () {
      const { voting, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await viem.assertions.emitWithArgs(
        voting.write.vote([100n, parseEther("50")], {
          account: alice.account,
        }),
        voting,
        "Voted",
        [getAddress(alice.account.address), 100n, parseEther("50")]
      );
    });

    it("3. stacks votes from two voters on the same price", async function () {
      const { voting, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await voting.write.vote([100n, parseEther("30")], {
        account: bob.account,
      });

      assert.equal(await voting.read.weightOf([100n]), parseEther("80"));
    });

    it("4. selects the price with more voting weight", async function () {
      const { voting, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await voting.write.vote([200n, parseEther("80")], {
        account: bob.account,
      });

      const [price, weight] = await voting.read.leader();

      assert.equal(price, 200n);
      assert.equal(weight, parseEther("80"));
    });

    it("5. allows one voter to vote for different prices", async function () {
      const { voting, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("40")], {
        account: alice.account,
      });

      await voting.write.vote([200n, parseEther("30")], {
        account: alice.account,
      });

      assert.equal(await voting.read.weightOf([100n]), parseEther("40"));
      assert.equal(await voting.read.weightOf([200n]), parseEther("30"));

      assert.equal(
        await voting.read.lockedOf([alice.account.address]),
        parseEther("70")
      );
    });

    it("6. updates the leader when another price gets more weight", async function () {
      const { voting, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await voting.write.vote([200n, parseEther("40")], {
        account: bob.account,
      });

      await voting.write.vote([200n, parseEther("20")], {
        account: bob.account,
      });

      const [price, weight] = await voting.read.leader();

      assert.equal(price, 200n);
      assert.equal(weight, parseEther("60"));
    });

    it("7. does not update the leader when there is a tie", async function () {
      const { voting, alice, bob } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await voting.write.vote([200n, parseEther("50")], {
        account: bob.account,
      });

      const [price, weight] = await voting.read.leader();

      assert.equal(price, 100n);
      assert.equal(weight, parseEther("50"));
    });

    it("8. reverts when voting has ended", async function () {
      const { voting, alice, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await endVoting(votingEnd);

      await assert.rejects(
        voting.write.vote([100n, parseEther("50")], {
          account: alice.account,
        })
      );
    });

    it("9. reverts when the voting amount is zero", async function () {
      const { voting, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await assert.rejects(
        voting.write.vote([100n, 0n], { account: alice.account })
      );
    });

    it("10. reverts when the voter has not approved enough tokens", async function () {
      const { voting, token, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await token.write.approve([voting.address, 0n], {
        account: alice.account,
      });

      await assert.rejects(
        voting.write.vote([100n, parseEther("50")], {
          account: alice.account,
        })
      );
    });
  });

  describe("finalize", function () {
    it("11. reverts when called before voting ends", async function () {
      const { voting } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await assert.rejects(voting.write.finalize());
    });

    it("12. reverts when called twice", async function () {
      const { voting, alice, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await endVoting(votingEnd);

      await voting.write.finalize();

      await assert.rejects(voting.write.finalize());
    });

    it("13. sets the winning price and emits PriceFinalized", async function () {
      const { voting, alice, bob, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await voting.write.vote([200n, parseEther("30")], {
        account: bob.account,
      });

      await endVoting(votingEnd);

      await viem.assertions.emitWithArgs(
        voting.write.finalize(),
        voting,
        "PriceFinalized",
        [100n, parseEther("50")]
      );

      assert.equal(await voting.read.currentTokenPrice(), 100n);
      assert.equal(await voting.read.finalized(), true);
    });

    it("14. succeeds with no votes and keeps the price at zero", async function () {
      const { voting, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await endVoting(votingEnd);

      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 0n);
      assert.equal(await voting.read.finalized(), true);
    });

    it("15. succeeds with a tie and keeps the price at zero", async function () {
      const { voting, alice, bob, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await voting.write.vote([200n, parseEther("50")], {
        account: bob.account,
      });

      await endVoting(votingEnd);

      await voting.write.finalize();

      assert.equal(await voting.read.currentTokenPrice(), 0n);
      assert.equal(await voting.read.finalized(), true);
    });
  });

  describe("claim", function () {
    it("16. reverts when called before voting ends", async function () {
      const { voting, alice } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await assert.rejects(
        voting.write.claim({ account: alice.account })
      );
    });

    it("17. reverts when the voter has nothing locked", async function () {
      const { voting, alice, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await endVoting(votingEnd);

      await assert.rejects(
        voting.write.claim({ account: alice.account })
      );
    });

    it("18. returns the correct tokens and clears the locked balance", async function () {
      const { voting, token, alice, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await endVoting(votingEnd);

      const balanceBefore = await token.read.balanceOf([
        alice.account.address,
      ]);

      const hash = await voting.write.claim({
  account: alice.account,
});

const client = await viem.getPublicClient();
const receipt = await client.getTransactionReceipt({ hash });

const claimedEvent = receipt.logs.some((log) => {
  try {
    const decoded = decodeEventLog({
      abi: voting.abi,
      data: log.data,
      topics: log.topics,
    });

    return (
      log.address.toLowerCase() === voting.address.toLowerCase() &&
      decoded.eventName === "Claimed"
    );
  } catch {
    return false;
  }
});

assert.equal(claimedEvent, true, "Claimed event should be emitted");

      const balanceAfter = await token.read.balanceOf([
        alice.account.address,
      ]);

      assert.equal(
        balanceAfter - balanceBefore,
        parseEther("50")
      );

      assert.equal(
        await voting.read.lockedOf([alice.account.address]),
        0n
      );
    });

    it("19. prevents a voter from claiming twice", async function () {
      const { voting, alice, votingEnd } =
        await networkHelpers.loadFixture(deployVotingFixture);

      await voting.write.vote([100n, parseEther("50")], {
        account: alice.account,
      });

      await endVoting(votingEnd);

      await voting.write.claim({ account: alice.account });

      await assert.rejects(
        voting.write.claim({ account: alice.account })
      );
    });
  });
});
