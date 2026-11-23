
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem } = await network.connect();

const LOCKED_ADDRESS = "0x000000000000000000000000000000000000dead";

describe("Pair (pull-based AMM)", function () {
  async function deployFixture() {
    const [deployer, alice] = await viem.getWalletClients();

    const tokenA = await viem.deployContract("Token", [
      "Token A",
      "AAA",
      parseEther("1000000"),
    ]);
    const tokenB = await viem.deployContract("Token", [
      "Token B",
      "BBB",
      parseEther("1000000"),
    ]);

    const pair = await viem.deployContract("Pair", [
      tokenA.address,
      tokenB.address,
    ]);

    await tokenA.write.transfer([
      alice.account.address,
      parseEther("100000"),
    ]);
    await tokenB.write.transfer([
      alice.account.address,
      parseEther("100000"),
    ]);

    for (const w of [deployer, alice]) {
      await tokenA.write.approve(
        [pair.address, parseEther("1000000")],
        { account: w.account },
      );
      await tokenB.write.approve(
        [pair.address, parseEther("1000000")],
        { account: w.account },
      );
    }

    return { pair, tokenA, tokenB, deployer, alice };
  }

  it("a swap charges the 0.3% fee, moves the price, and does not let k decrease", async function () {
    const { pair, tokenA, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    const r0Before = (await pair.read.reserve0()) as bigint;
    const r1Before = (await pair.read.reserve1()) as bigint;
    const kBefore = r0Before * r1Before;

    const amountIn = parseEther("100");
    const expectedOut = (await pair.read.getAmountOut([
      amountIn,
      r0Before,
      r1Before,
    ])) as bigint;

    await pair.write.swap(
      [tokenA.address, amountIn, 0n],
      { account: alice.account },
    );

    const r0After = (await pair.read.reserve0()) as bigint;
    const r1After = (await pair.read.reserve1()) as bigint;

    assert.equal(r0After, r0Before + amountIn);
    assert.equal(r1After, r1Before - expectedOut);
    assert.ok(
      expectedOut > parseEther("90") &&
        expectedOut < parseEther("91"),
      `got ${expectedOut}`,
    );
    assert.ok(r0After * r1After > kBefore);
  });

  it("locks minimum liquidity for the first provider", async function () {
  const { pair, deployer } = await deployFixture();

  await pair.write.addLiquidity([
    parseEther("1000"),
    parseEther("1000"),
  ]);

  const lockedLP = (await pair.read.balanceOf([
    LOCKED_ADDRESS,
  ])) as bigint;

  const deployerLP = (await pair.read.balanceOf([
    deployer.account.address,
  ])) as bigint;

  const totalSupply = (await pair.read.totalSupply()) as bigint;

  assert.equal(lockedLP, 1000n);
  assert.equal(deployerLP, parseEther("1000") - 1000n);
  assert.equal(totalSupply, parseEther("1000"));
});

  it("accepts a proportional subsequent liquidity deposit", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await pair.write.addLiquidity(
      [parseEther("500"), parseEther("500")],
      { account: alice.account },
    );

    const reserve0 = (await pair.read.reserve0()) as bigint;
    const reserve1 = (await pair.read.reserve1()) as bigint;
    const aliceLP = (await pair.read.balanceOf([
      alice.account.address,
    ])) as bigint;

    assert.equal(reserve0, parseEther("1500"));
    assert.equal(reserve1, parseEther("1500"));
    assert.equal(aliceLP, parseEther("500"));
  });

  it("uses the limiting token amount for an out-of-ratio deposit", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await pair.write.addLiquidity(
      [parseEther("500"), parseEther("250")],
      { account: alice.account },
    );

    const reserve0 = (await pair.read.reserve0()) as bigint;
    const reserve1 = (await pair.read.reserve1()) as bigint;
    const aliceLP = (await pair.read.balanceOf([
      alice.account.address,
    ])) as bigint;

    assert.equal(reserve0, parseEther("1500"));
    assert.equal(reserve1, parseEther("1250"));
    assert.equal(aliceLP, parseEther("250"));
  });

  it("removes liquidity proportionally and burns LP tokens", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await pair.write.addLiquidity(
      [parseEther("500"), parseEther("500")],
      { account: alice.account },
    );

    await pair.write.removeLiquidity(
      [parseEther("250")],
      { account: alice.account },
    );

    const reserve0 = (await pair.read.reserve0()) as bigint;
    const reserve1 = (await pair.read.reserve1()) as bigint;
    const aliceLP = (await pair.read.balanceOf([
      alice.account.address,
    ])) as bigint;

    assert.equal(reserve0, parseEther("1250"));
    assert.equal(reserve1, parseEther("1250"));
    assert.equal(aliceLP, parseEther("250"));
  });

  it("supports swaps in the reverse direction from Token B to Token A", async function () {
    const { pair, tokenB, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    const r0Before = (await pair.read.reserve0()) as bigint;
    const r1Before = (await pair.read.reserve1()) as bigint;
    const kBefore = r0Before * r1Before;

    const amountIn = parseEther("100");
    const expectedOut = (await pair.read.getAmountOut([
      amountIn,
      r1Before,
      r0Before,
    ])) as bigint;

    await pair.write.swap(
      [tokenB.address, amountIn, 0n],
      { account: alice.account },
    );

    const r0After = (await pair.read.reserve0()) as bigint;
    const r1After = (await pair.read.reserve1()) as bigint;

    assert.equal(r0After, r0Before - expectedOut);
    assert.equal(r1After, r1Before + amountIn);
    assert.ok(r0After * r1After >= kBefore);
  });
});
