import ccxt from 'ccxt'
import { protoDescriptor } from "./grpc";
import { Server, ServerCredentials } from '@grpc/grpc-js';
export const logger = require('pino')()
export const healthCheck = require('grpc-health-check');
import https from 'https';

let crcExcahnge: number = 0;

const getCrc = () => {
  https.get('https://api.exchangeratesapi.io/v1/latest?access_key=f972721cec74736fd7d7caf42ecf5d18&base=USD&symbols=CRC', (resp) => {
    let data = '';

    // A chunk of data has been received.
    resp.on('data', (chunk) => {
      data += chunk;
    });

    // The whole response has been received. Print out the result.
    resp.on('end', () => {
      const json: any = JSON.parse(data)
      if(json.success) {
        crcExcahnge = json.rates.CRC
      }
    });
  }).on("error", (err) => {
    console.log("Error: " + err.message);
  });
}

setInterval(getCrc, 60 * 1000 * 240)

getCrc()

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Define service status map. Key is the service name, value is the corresponding status.
// By convention, the empty string "" key represents that status of the entire server.
const statusMap = {
  "": 2,

  // 1 is serving
  // 2 is not serving
};

// Construct the health service implementation
export const healthImpl = new healthCheck.Implementation(statusMap);


const exchange_init = {
  'enableRateLimit': true,
  'rateLimit': 2000,
  'timeout': 8000,
}

const exchanges_json = [
  {
    name: "bitfinex",
    pair: "BTC/USD"
  },
  {
    name: "binance",
    pair: "BTC/USDT"
  }, 
  {
    name: "ftx",
    pair: "BTC/USD"
  } 
]

const exchanges: any[] = []

export const median = arr => {
  const arr_ = arr.filter(n => !!n)
  const mid = Math.floor(arr_.length / 2),
    nums = [...arr_].sort((a, b) => a - b);
  return arr_.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

const Ticker = {
  bid: undefined, 
  ask: undefined, 
  timestamp: undefined, 
  percentage: undefined,
  get active() {
    const staleAfter = 30 * 1000 // value in ms
  
    try {
      return new Date().getTime() - this.timestamp! < staleAfter 
    } catch (err) {
      logger.error({err}, "can't decode input")
      return false
    }
  },
  get mid() {
    try {
      if (!this.active) {
        return NaN
      }
      return (this.ask! + this.bid!) / 2
    } catch (err) {
      return NaN
    }
  }
}

interface Data {
  exchanges: {
    bitfinex: typeof Ticker,
    binance: typeof Ticker,
    ftx: typeof Ticker,
  }
  totalActive: number,
  mid: number,
  percentage: number
  spread: number,
  asks: number[],
  bids: number[],
}

export const data: Data = {
  exchanges: {
    bitfinex: Ticker,
    binance: Ticker,
    ftx: Ticker,
  },
  // exchanges: {
  //  "bifinex": Ticker,
  //  "binance": Ticker,
  //  "ftx": Ticker,
  // }
  get totalActive() {
    const total = Object.values(this.exchanges).reduce((total, {active}) => total + (active ? 1 : 0), 0)
    healthImpl.setStatus('', total > 0 ? 1 : 2);
    return total
  },
  get bids() {
    const bids: number[] = []
    Object.values(this.exchanges).forEach(({bid, active}) => {
      if (!!bid && active) { 
        bids.push(bid!) 
      }
    })
    return bids
  },
  get asks() {
    const asks: number[] = []
    Object.values(this.exchanges).forEach(({ask, active}) => {
      if (!!ask && active) { 
        asks.push(ask!)  
      }
    })
    return asks
  },
  get mid() {
    const ask = median(this.asks)
    const bid = median(this.bids)
    return (ask + bid) / 2
  },
  get spread() {
    const high_ask = Math.max(...this.asks)
    const low_bid = Math.min(...this.bids)
    const spread = (high_ask - low_bid) / low_bid
    return spread
  },
  get percentage() {
    // FIXME: different scale
    // binance: {
    //   percentage: 5.583
    // },
    // ftx: {
    //   percentage: 0.05661823757027086
    // }
    const percentages: number[] = []
    Object.values(this.exchanges).forEach(({percentage}) => {
      if (!!percentage) { 
        percentages.push(percentage!)  
      }
    })
    return median(percentages)
  }
}


export const init = () => {
  // FIXME: if the exchange doesn't initialize properly on the first call
  // then it seems ccxt will never be able to fetch data back from this exchange
  // so in case of init failure there should be a loop such that the init keep retrying
  // until succesful, with some form of a backoff.

  // look at: https://github.com/ccxt/ccxt/wiki/Manual#market-cache-force-reload
  for (const exchange_json of exchanges_json) {
    const exchange = new ccxt[exchange_json.name](exchange_init)
    exchange.pair = exchange_json.pair
    exchanges.push(exchange)
  }
}

export const refresh = async (exchange) => {
    let bid, ask, percentage, timestamp

    try {
      ({bid, ask, percentage, timestamp} = await exchange.fetchTicker(exchange.pair))

    //   {
    //     symbol: 'BTC/USD',
    //     timestamp: 1616073510751,
    //     datetime: '2021-03-18T13:18:30.751Z',
    //     high: undefined,
    //     low: undefined,
    //     bid: 57996,
    //     bidVolume: undefined,
    //     ask: 57997,
    //     askVolume: undefined,
    //     vwap: undefined,
    //     open: undefined,
    //     close: 57992,
    //     last: 57992,
    //     previousClose: undefined,
    //     change: undefined,
    //     percentage: 0.05067120781173572,
    //     average: undefined,
    //     baseVolume: undefined,
    //     quoteVolume: 269803113.9994,
    //     info: {
    //       raw response...
    //     }
    //   }

  } catch (err) {
      logger.warn({err}, `can't refresh ${exchange.id}`)
      await sleep(5000)
      return
    }

    // FIXME: the object should be recycled instead of being recrated/replaced
    const ticker = Object.create(Ticker)

    ticker.ask = ask * crcExcahnge
    ticker.bid = bid * crcExcahnge
    ticker.timestamp = timestamp
    ticker.percentage = percentage

    data.exchanges[exchange.id] = ticker
}

const loop = async (exchange) => {
  await refresh(exchange)
  
  const refresh_time = 2000

  logger.debug({
    exchanges: data.exchanges,
    totalActive: data.totalActive,
    mid: data.mid,
    spread: data.spread,
    percentage: data.percentage,
    bids: data.bids,
    asks: data.asks,
    exchange_updated: exchange.id,
  })

  setTimeout(async function () {
    // TODO check if this could lead to a stack overflow
    loop(exchange)
  }, refresh_time);
}

export const main = async () => {
  init()
  await sleep(500)

  exchanges.forEach(exchange => loop(exchange))
}


function getPrice(call, callback) {
  callback(null, {price: data.mid})
}


function getServer() {
  const server = new Server();
  server.addService(protoDescriptor.PriceFeed.service, { getPrice });
  server.addService(healthCheck.service, healthImpl);
  return server;
}

const port = 50051

const routeServer = getServer();
routeServer.bindAsync(`0.0.0.0:${port}`, 
  ServerCredentials.createInsecure(), () => {
    logger.info(`Price server running on port ${port}`)
    main()
    routeServer.start();
});


