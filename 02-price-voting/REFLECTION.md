# Reflection – Voting on Token Price

If voters could withdraw their locked tokens before `votingEnd`, the voting system could become unfair.

The main problem would affect the `weightOf(price)` state variable. It stores the total voting weight for each proposed price. If a voter withdraws their tokens, their recorded voting weight might remain unchanged even though the tokens are no longer locked in the contract.

This could allow the same tokens to be withdrawn and potentially used again while still influencing the previous vote. As a result, the voting outcome would not accurately represent the tokens actually locked during the voting period.

Therefore, voters must keep their tokens locked until voting ends. They can claim their tokens only after `votingEnd`.
