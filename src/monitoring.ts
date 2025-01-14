import { MeterProvider } from '@opentelemetry/metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';


// this is starting the main server
import { data, logger } from ".";


const prometheusPort = PrometheusExporter.DEFAULT_OPTIONS.port;
const prometheusEndpoint = PrometheusExporter.DEFAULT_OPTIONS.endpoint;

const exporter = new PrometheusExporter(
  {
    // @ts-ignore
    startServer: true,
  },
  () => {
    logger.info(
      {endpoint: `http://localhost:${prometheusPort}${prometheusEndpoint}`},
      `prometheus scrape ready`
    );
  },
);

const meter = new MeterProvider({
  exporter,
  interval: 2000,
}).getMeter('your-meter-name');

meter.createValueObserver('price', {
  description: 'Example of a sync observer with callback',
}, (observerResult) => {
  observerResult.observe(data.mid, { label: 'median' });
  observerResult.observe(data.exchanges['bitfinex2'].mid, { label: 'bitfinex2' });
  observerResult.observe(data.exchanges['coinbase'].mid, { label: 'coinbase' });
  observerResult.observe(data.exchanges['kraken'].mid, { label: 'kraken' });
});

