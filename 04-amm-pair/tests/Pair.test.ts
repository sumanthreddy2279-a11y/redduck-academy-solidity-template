
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

  // Check total LP supply before removal
  const totalSupplyBefore = (await pair.read.totalSupply()) as bigint;

  await pair.write.removeLiquidity(
    [parseEther("250")],
    { account: alice.account },
  );

  const reserve0 = (await pair.read.reserve0()) as bigint;
  const reserve1 = (await pair.read.reserve1()) as bigint;

  const aliceLP = (await pair.read.balanceOf([
    alice.account.address,
  ])) as bigint;

  // Check total LP supply after removal
  const totalSupplyAfter = (await pair.read.totalSupply()) as bigint;

  assert.equal(reserve0, parseEther("1250"));
  assert.equal(reserve1, parseEther("1250"));
  assert.equal(aliceLP, parseEther("250"));

  // Verify that burned LP tokens reduce total supply
  assert.equal(
    totalSupplyAfter,
    totalSupplyBefore - parseEther("250"),
  );
});
