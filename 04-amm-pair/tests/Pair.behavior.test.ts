import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, toEventSelector } from "viem";

const { viem } = await network.connect();

const LOCKED_ADDRESS = "0x000000000000000000000000000000000000dead";

describe("Pair (liquidity and edge cases)", function () {
  async function deployFixture() {
    const [deployer, alice] = await viem.getWalletClients();

    const tokenA = await viem.deployContract("Token", ["Token A", "AAA", parseEther("1000000")]);

    const tokenB = await viem.deployContract("Token", ["Token B", "BBB", parseEther("1000000")]);

    const pair = await viem.deployContract("Pair", [tokenA.address, tokenB.address]);

    await tokenA.write.transfer([alice.account.address, parseEther("100000")]);
    await tokenB.write.transfer([alice.account.address, parseEther("100000")]);

    for (const wallet of [deployer, alice]) {
      await tokenA.write.approve([pair.address, parseEther("1000000")], {
        account: wallet.account,
      });

      await tokenB.write.approve([pair.address, parseEther("1000000")], {
        account: wallet.account,
      });
    }

    return { pair, tokenA, tokenB, deployer, alice };
  }

  it("mints initial LP tokens and permanently locks minimum liquidity", async function () {
    const { pair, deployer } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const userLP = await pair.read.balanceOf([deployer.account.address]);
    const lockedLP = await pair.read.balanceOf([LOCKED_ADDRESS]);
    const total = await pair.read.totalSupply();

    assert.equal(userLP, parseEther("1000") - 1000n);
    assert.equal(lockedLP, 1000n);
    assert.equal(total, parseEther("1000"));
  });

  it("mints proportional LP tokens for subsequent deposits", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await pair.write.addLiquidity([parseEther("500"), parseEther("500")], {
      account: alice.account,
    });

    const aliceLP = await pair.read.balanceOf([alice.account.address]);

    assert.equal(aliceLP, parseEther("500"));

    assert.equal(await pair.read.reserve0(), parseEther("1500"));

    assert.equal(await pair.read.reserve1(), parseEther("1500"));
  });

  it("uses the smaller side for out-of-ratio deposits", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await pair.write.addLiquidity([parseEther("500"), parseEther("250")], {
      account: alice.account,
    });

    const aliceLP = await pair.read.balanceOf([alice.account.address]);

    assert.equal(aliceLP, parseEther("250"));
    assert.equal(await pair.read.reserve0(), parseEther("1500"));
    assert.equal(await pair.read.reserve1(), parseEther("1250"));
  });

  it("allows liquidity providers to remove proportional liquidity", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await pair.write.addLiquidity([parseEther("500"), parseEther("500")], {
      account: alice.account,
    });

    await pair.write.removeLiquidity([parseEther("250")], { account: alice.account });

    assert.equal(await pair.read.reserve0(), parseEther("1250"));
    assert.equal(await pair.read.reserve1(), parseEther("1250"));

    assert.equal(await pair.read.balanceOf([alice.account.address]), parseEther("250"));
  });

  it("rejects a swap when the minimum output is too high", async function () {
    const { pair, tokenA, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const expectedOut = await pair.read.getAmountOut([
      parseEther("100"),
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await assert.rejects(async () => {
      await pair.write.swap([tokenA.address, parseEther("100"), expectedOut + 1n], {
        account: alice.account,
      });
    });
  });

  it("rejects swaps using an invalid token", async function () {
    const { pair, alice } = await deployFixture();

    const tokenC = await viem.deployContract("Token", ["Token C", "CCC", parseEther("1000000")]);

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await assert.rejects(async () => {
      await pair.write.swap([tokenC.address, parseEther("10"), 0n], { account: alice.account });
    });
  });

  it("rejects zero liquidity deposits", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(async () => {
      await pair.write.addLiquidity([0n, parseEther("100")]);
    });
  });

  it("rejects zero input in getAmountOut", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(async () => {
      await pair.read.getAmountOut([0n, 1000n, 1000n]);
    });
  });

  it("rejects swaps when reserves are empty", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(async () => {
      await pair.read.getAmountOut([100n, 0n, 1000n]);
    });
  });

  it("rejects liquidity deposits when token1 amount is zero", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(async () => {
      await pair.write.addLiquidity([parseEther("100"), 0n]);
    });
  });

  it("rejects zero liquidity removal", async function () {
    const { pair } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await assert.rejects(async () => {
      await pair.write.removeLiquidity([0n]);
    });
  });

  it("rejects output calculations when output reserve is zero", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(async () => {
      await pair.read.getAmountOut([100n, 1000n, 0n]);
    });
  });

  it("returns the correct token balances after liquidity removal", async function () {
    const { pair, tokenA, tokenB, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await pair.write.addLiquidity([parseEther("500"), parseEther("500")], {
      account: alice.account,
    });

    const balanceA = await tokenA.read.balanceOf([alice.account.address]);
    const balanceB = await tokenB.read.balanceOf([alice.account.address]);

    await pair.write.removeLiquidity([parseEther("250")], { account: alice.account });

    assert.equal(
      await tokenA.read.balanceOf([alice.account.address]),
      balanceA + parseEther("250"),
    );

    assert.equal(
      await tokenB.read.balanceOf([alice.account.address]),
      balanceB + parseEther("250"),
    );
  });

  it("keeps minimum liquidity permanently locked after provider withdrawal", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    await pair.write.addLiquidity([parseEther("500"), parseEther("500")], {
      account: alice.account,
    });

    await pair.write.removeLiquidity([parseEther("500")], { account: alice.account });

    assert.equal(await pair.read.balanceOf([LOCKED_ADDRESS]), 1000n);

    assert.equal(await pair.read.totalSupply(), parseEther("1000"));
  });

  it("emits LiquidityAdded when liquidity is provided", async function () {
    const { pair } = await deployFixture();
    const publicClient = await viem.getPublicClient();

    const hash = await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    assert.ok(
      receipt.logs.some(
        (log) =>
          log.topics[0] === toEventSelector("LiquidityAdded(address,uint256,uint256,uint256)"),
      ),
      "LiquidityAdded event was not emitted",
    );
  });

  it("emits LiquidityRemoved when liquidity is withdrawn", async function () {
    const { pair } = await deployFixture();
    const publicClient = await viem.getPublicClient();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const hash = await pair.write.removeLiquidity([parseEther("100")]);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    assert.ok(
      receipt.logs.some(
        (log) =>
          log.topics[0] === toEventSelector("LiquidityRemoved(address,uint256,uint256,uint256)"),
      ),
      "LiquidityRemoved event was not emitted",
    );
  });

  it("emits Swapped when a token swap succeeds", async function () {
    const { pair, tokenA, alice } = await deployFixture();
    const publicClient = await viem.getPublicClient();

    await pair.write.addLiquidity([parseEther("1000"), parseEther("1000")]);

    const hash = await pair.write.swap([tokenA.address, parseEther("10"), 0n], {
      account: alice.account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    assert.ok(
      receipt.logs.some(
        (log) => log.topics[0] === toEventSelector("Swapped(address,address,uint256,uint256)"),
      ),
      "Swapped event was not emitted",
    );
  });
});
