// Splits a total into whole-cent shares, one per member, that always add up to the total.
// The cents that do not divide evenly go one each to the first members in the list,
// so the list must be in the order the members were added to the home.
// Example: 1000 cents between 3 members gives 334, 333, 333.
export function splitTotalCents<Member>(totalCents: number, members: Member[]) {
  const baseShareCents = Math.floor(totalCents / members.length)
  const leftoverCents = totalCents % members.length
  return members.map((member, index) => ({
    member,
    amountCents: baseShareCents + (index < leftoverCents ? 1 : 0),
  }))
}
