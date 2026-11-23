import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem, networkHelpers } = await network.connect();

const KEY_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CALLBACK_GAS = 500_000;

// Starter test: the happy path end to end — two deposits, time travel to the
// deadline, a forced VRF response, and a claim. It fails until deposit,
// drawWinner, fulfillRandomWords, and claim work. Don't edit it. Add tests for
// the failure modes and the weighted-pick boundaries in a separate file.
describe("Raffle", function () {
  async function deployFixture() {
    const [deployer, alice, bob] = await viem.getWalletClients();

    const btc = await viem.deployContract("Token", ["Bitcoin", "BTC", parseEther("1000000")]);
    const feed = await viem.deployContract("PriceFeedMock", [8, 60_000n * 10n ** 8n]);

    const coord = await viem.deployContract("VRFCoordinatorMock", [10n ** 17n, 10n ** 9n, 10n ** 15n]);

    await coord.write.createSubscription();
    const [created] = await coord.getEvents.SubscriptionCreated({}, { fromBlock: 0n });
    const subId = created.args.subId as bigint;
    await coord.write.fundSubscription([subId, parseEther("1000000")]);

    const now = await networkHelpers.time.latest();
    const drawTime = BigInt(now + 600);

    const raffle = await viem.deployContract("Raffle", [
      btc.address,
      feed.address,
      drawTime,
      coord.address,
      subId,
      KEY_HASH,
      CALLBACK_GAS,
    ]);
    await coord.write.addConsumer([subId, raffle.address]);

    for (const w of [alice, bob]) {
      await btc.write.transfer([w.account.address, parseEther("100")]);
      await btc.write.approve([raffle.address, parseEther("100")], { account: w.account });
    }

    return { btc, feed, coord, raffle, subId, drawTime, deployer, alice, bob };
  }

  it("runs the full raffle: deposit, draw, weighted winner, claim", async function () {
    const { btc, coord, raffle, drawTime, alice, bob } = await deployFixture();

    // Entry 0: alice (weight 1 BTC). Entry 1: bob (weight 3 BTC).
    await raffle.write.deposit([parseEther("1")], { account: alice.account });
    await raffle.write.deposit([parseEther("3")], { account: bob.account });

    await networkHelpers.time.increaseTo(drawTime);
    await raffle.write.drawWinner();

    const requestId = (await raffle.read.requestId()) as bigint;
    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    // A random word at the top of the range lands in bob's entry (index 1).
    await coord.write.fulfillRandomWordsWithOverride([requestId, raffle.address, [totalWeight - 1n]]);

    const before = (await btc.read.balanceOf([bob.account.address])) as bigint;
    await raffle.write.claim([1n], { account: bob.account });
    const after = (await btc.read.balanceOf([bob.account.address])) as bigint;

    assert.equal(after - before, parseEther("4"));
  });

  
  async function fulfillDraw(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    randomWord: bigint,
  ) {
    const { raffle, coord, drawTime } = fixture;

    await networkHelpers.time.increaseTo(drawTime);
    await raffle.write.drawWinner();

    const requestId = (await raffle.read.requestId()) as bigint;

    await coord.write.fulfillRandomWordsWithOverride([
      requestId,
      raffle.address,
      [randomWord],
    ]);
  }

  it("rejects zero deposits", async function () {
    const { raffle, alice } = await deployFixture();

    await assert.rejects(async () => {
      await raffle.write.deposit([0n], { account: alice.account });
    });
  });

  it("rejects deposits after the deadline", async function () {
    const { raffle, alice, drawTime } = await deployFixture();

    await networkHelpers.time.increaseTo(drawTime);

    await assert.rejects(async () => {
      await raffle.write.deposit(
        [parseEther("1")],
        { account: alice.account },
      );
    });
  });

  it("rejects deposits when the price feed is non-positive", async function () {
    const { raffle, feed, alice } = await deployFixture();

    await feed.write.updateAnswer([0n]);

    await assert.rejects(async () => {
      await raffle.write.deposit(
        [parseEther("1")],
        { account: alice.account },
      );
    });
  });

  it("rejects deposits when the price feed is stale", async function () {
    const [deployer, alice] = await viem.getWalletClients();

    const btc = await viem.deployContract("Token", [
      "Bitcoin",
      "BTC",
      parseEther("1000000"),
    ]);

    const feed = await viem.deployContract("PriceFeedMock", [
      8,
      60_000n * 10n ** 8n,
    ]);

    const coord = await viem.deployContract("VRFCoordinatorMock", [
      10n ** 17n,
      10n ** 9n,
      10n ** 15n,
    ]);

    await coord.write.createSubscription();
    const [created] = await coord.getEvents.SubscriptionCreated(
      {},
      { fromBlock: 0n },
    );
    const subId = created.args.subId as bigint;

    await coord.write.fundSubscription([
      subId,
      parseEther("1000000"),
    ]);

    const now = await networkHelpers.time.latest();
    const drawTime = BigInt(now + 7200);

    const raffle = await viem.deployContract("Raffle", [
      btc.address,
      feed.address,
      drawTime,
      coord.address,
      subId,
      KEY_HASH,
      CALLBACK_GAS,
    ]);

    await coord.write.addConsumer([subId, raffle.address]);

    await btc.write.transfer([
      alice.account.address,
      parseEther("100"),
    ]);

    await btc.write.approve(
      [raffle.address, parseEther("100")],
      { account: alice.account },
    );

    await networkHelpers.time.increase(3601);

    await assert.rejects(async () => {
      await raffle.write.deposit(
        [parseEther("1")],
        { account: alice.account },
      );
    });
  });

  it("rejects drawing before the deadline", async function () {
    const { raffle, alice } = await deployFixture();

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await assert.rejects(async () => {
      await raffle.write.drawWinner();
    });
  });

  it("rejects drawing when there are no entries", async function () {
    const { raffle, drawTime } = await deployFixture();

    await networkHelpers.time.increaseTo(drawTime);

    await assert.rejects(async () => {
      await raffle.write.drawWinner();
    });
  });

  it("allows only one VRF draw request", async function () {
    const { raffle, alice, drawTime } = await deployFixture();

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await networkHelpers.time.increaseTo(drawTime);

    await raffle.write.drawWinner();

    await assert.rejects(async () => {
      await raffle.write.drawWinner();
    });
  });

  it("rejects claims before randomness is fulfilled", async function () {
    const { raffle, alice, drawTime } = await deployFixture();

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await networkHelpers.time.increaseTo(drawTime);
    await raffle.write.drawWinner();

    await assert.rejects(async () => {
      await raffle.write.claim([0n], { account: alice.account });
    });
  });

  it("rejects a claim from someone other than the winning player", async function () {
    const fixture = await deployFixture();
    const { raffle, alice, bob } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await raffle.write.deposit(
      [parseEther("3")],
      { account: bob.account },
    );

    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    await fulfillDraw(fixture, totalWeight - 1n);

    await assert.rejects(async () => {
      await raffle.write.claim([1n], { account: alice.account });
    });
  });

  it("rejects a claim using the wrong entry index", async function () {
    const fixture = await deployFixture();
    const { raffle, alice, bob } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await raffle.write.deposit(
      [parseEther("3")],
      { account: bob.account },
    );

    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    await fulfillDraw(fixture, totalWeight - 1n);

    await assert.rejects(async () => {
      await raffle.write.claim([0n], { account: bob.account });
    });
  });

  it("rejects an out-of-range entry index", async function () {
    const fixture = await deployFixture();
    const { raffle, alice } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    await fulfillDraw(fixture, 0n);

    await assert.rejects(async () => {
      await raffle.write.claim([1n], { account: alice.account });
    });
  });

  it("rejects a second claim after the prize is claimed", async function () {
    const fixture = await deployFixture();
    const { raffle, alice } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await fulfillDraw(fixture, 0n);

    await raffle.write.claim([0n], { account: alice.account });

    await assert.rejects(async () => {
      await raffle.write.claim([0n], { account: alice.account });
    });
  });

  it("selects the first entry at the lower weighted boundary", async function () {
    const fixture = await deployFixture();
    const { raffle, alice, bob } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await raffle.write.deposit(
      [parseEther("3")],
      { account: bob.account },
    );

    const firstWeight = (await raffle.read.totalWeight()) as bigint;
    const weightOfFirstEntry = firstWeight / 4n;

    await fulfillDraw(fixture, weightOfFirstEntry - 1n);

    const selected = await raffle.read.getWinningEntryIndex();

    assert.equal(selected, 0n);
  });

  it("selects the second entry exactly at the first entry's upper boundary", async function () {
    const fixture = await deployFixture();
    const { raffle, alice, bob } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await raffle.write.deposit(
      [parseEther("3")],
      { account: bob.account },
    );

    const totalWeight = (await raffle.read.totalWeight()) as bigint;
    const firstWeight = totalWeight / 4n;

    await fulfillDraw(fixture, firstWeight);

    const selected = await raffle.read.getWinningEntryIndex();

    assert.equal(selected, 1n);
  });

  it("selects the last entry at the maximum random boundary", async function () {
    const fixture = await deployFixture();
    const { raffle, alice, bob } = fixture;

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    await raffle.write.deposit(
      [parseEther("3")],
      { account: bob.account },
    );

    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    await fulfillDraw(fixture, totalWeight - 1n);

    const selected = await raffle.read.getWinningEntryIndex();

    assert.equal(selected, 1n);
  });

  it("preserves USD weights when the price changes after a deposit", async function () {
    const { raffle, feed, alice, bob } = await deployFixture();

    await raffle.write.deposit(
      [parseEther("1")],
      { account: alice.account },
    );

    const firstWeight = (await raffle.read.totalWeight()) as bigint;

    await feed.write.updateAnswer([
      120_000n * 10n ** 8n,
    ]);

    await raffle.write.deposit(
      [parseEther("1")],
      { account: bob.account },
    );

    const totalWeight = (await raffle.read.totalWeight()) as bigint;

    assert.equal(totalWeight, firstWeight * 3n);
  });

});
