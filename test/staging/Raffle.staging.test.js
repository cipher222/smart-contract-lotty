const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
!developmentChains.includes(network.name)

developmentChains.includes(network.name) //skips staging if on local network
    ? describe.skip
    : describe("Raffle", function () {
          let raffle, raffleEntraceFee, deployer, interval //global vars

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              raffle = await ethers.getContract("Raffle", deployer)
              raffleEntraceFee = await raffle.getEntranceFee()
          })
          describe("fulfullRandomWords", function () {
              it("works with live chainlink keepers and vrf, we get a random winner", async function () {
                  //enter the raffle
                  const startingTimeStamp = await raffle.getLatestTimeStamp()
                  const accounts = await ethers.getSigners()
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("WInnerPicked event fired!")
                          resolve()
                          try {
                              //add our asserts
                              const recentWiner = await raffle.getRecentWinner()
                              const raffleState = await raffle.getRaffleState()
                              const winnerEndingBalance = await accounts[0].getBalance()
                              const endingTimeStamp = await raffle.getLatestTimeStamp()
                              await expect(raffle.getPlayer(0)).to.be.reverted //this will be reverted if the array was not reset
                              assert.equal(recentWiner.toString(), accounts[0].address)
                              assert.equal(raffleState, 0)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(raffleEntraceFee).toString()
                              ) //they are the only ones that entered the raffle
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve() //if there are any issues with these asserts we will catch those errors and reject
                          } catch (error) {
                              console.log(error)
                              reject(e)
                          }
                      })
                      //setup listner before we enter the raffle
                      await raffle.enterRaffle({ value: raffleEntraceFee })
                      const winnerStartingBalance = await accounts[0].getBalance()
                      // this code wont complete until our listener has finished listening!
                  })
                  //what we need to do before running our staging tests: (explained at 16:18)
                  //get sub id, deploy contract with chainlink vrf + its sub id, register the contract wit chainlink vrf and its sub id, register the contract with chainlink keepers, and run staging tests
              })
          })
      })
