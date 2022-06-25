const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle", function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntraceFee, deployer, interval //global vars
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["mocks", "raffle"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
              raffleEntraceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })
          describe("contructor", function () {
              it("Initializes the raffle correctly", async function () {
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterRaffle", function () {
              it("reverts when you dont pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })
              it("records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  const playerFromContract = await raffle.getPlayers(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntraceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })
              it("doesnt allow entrance when raffle is calculation", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //pretend to be a chainlink keeper
                  await raffle.performUpkeep([])
                  await expect(raffle.enterRaffle({ value: raffleEntraceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //increases time
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded) //not true whick is true hopfully
              })
              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //increases time
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([]) //this makes the raffle state closed
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              it("returns false if enough time hasn't passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1]) //increases time
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded) //not true whick is true hopfully
              })

              it("returns true is enough time has passed, has player, eth, and is open", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //increases time
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert(upkeepNeeded) //not true whick is true hopfully
              })
          })
          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //increases time
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx) //this will fail if performUpkeep fails
              })
              it("will revert performUpkeep is checkUpkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffke__UpkeepNotNeeded"
                  ) //our test is smart enough to know if all we put is the name of the error the funtion is being reverted with then its good enough
              })
              it("it updates the raffle state, emits an event, and calls the vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //increases time
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId //this is event (1) because requestRandomWords actualy emits an event
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert.equal(raffleState.toString(), "1")
              })
          })
          describe("fuffillRandomWords", function () {
              //REVEIW AT 16:05
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntraceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) //increases time
                  await network.provider.send("evm_mine", [])
              })
              it("it can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request") //fufillRandomWords has an if statment that will revert the tx if the request does not exist
                  //takes a request id and address and address. If the request id == 0 revert
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request") //this should be reverted as well. Idealy no request id would ever allow the transaction to be reverted
              })
              it("pics a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 //deployer = 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex; //connects all of the accounts
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntraceFee }) //have all of the new accounts enter the raffle
                  }
                  const startingTimeStamp = await raffle.getLatestTimeStamp()
                  //performUpkeep (mock being chainlink keepers)
                  //that kicks of fulfillRandomWords (mock being the chainlink vrf)
                  //we will have to wait for the fulfillRandomWords to be called
                  await new Promise(async (resolve, reject) => {
                      //listen for the WinnerPicked event to be omited or if it doesn't revert the transaction after 200 seconds (defined in mocha)
                      //set up listner before we trigger all of our event so it is waiting
                      raffle.once("WinnerPicked", async () => {
                          console.log("Found the event!") //this only happens after WinnerPicked is fired which we initiate below
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              console.log(recentWinner)
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[2].address)
                              console.log(accounts[3].address)
                              const winnerEndingBalance = await accounts[1].getBalance()
                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLatestTimeStamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntraceFee
                                          .mul(additionalEntrants)
                                          .add(raffleEntraceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })

                      //setting up the listener
                      //below, we will fire the even, and the listener wil pick it up, andresolve
                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          //this function should emit a winner picked event to resolve our promis
                          //pretend to be mock
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
