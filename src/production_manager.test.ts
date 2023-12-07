import { Static } from '@sinclair/typebox';
import { ProductionManager } from './production_manager';
import { NewProduction, Production } from './models';
import { SmbEndpointDescription } from './smb';

type NewProduction = Static<typeof NewProduction>;
type Production = Static<typeof Production>;

const SmbEndpointDescriptionMock: SmbEndpointDescription = {
  'bundle-transport': {
    dtls: {
      setup: 'actpass',
      type: 'sha-256',
      hash: '8F:C2:B8:3F:07:53:0C:F5:07:EF:EC:EB:93:DF:4E:7A:1B:E1:11:A8:A9:7B:9F:EE:86:EE:BD:05:77:83:CD:D2'
    },
    ice: {
      ufrag: 'wX4aN8AyMUVadg',
      pwd: '4cLWhgmLHtYZgncvuopUh+3r',
      candidates: [
        {
          foundation: '716080445600',
          component: 1,
          protocol: 'udp',
          priority: 142541055,
          ip: '35.240.205.93',
          port: 10000,
          type: 'host',
          generation: 0,
          network: 1
        }
      ]
    }
  },
  audio: {
    'payload-type': {
      id: 111,
      parameters: {
        minptime: '10',
        useinbandfec: '1'
      },
      'rtcp-fbs': [],
      name: 'opus',
      clockrate: 48000,
      channels: 2
    },
    ssrcs: [1234, 355667],
    'rtp-hdrexts': [
      {
        id: 1,
        uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level'
      },
      {
        id: 3,
        uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time'
      }
    ]
  },
  data: {
    port: 5000
  }
};

describe('production_manager', () => {
  it('creates a production object and save it to the class instance', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    productionManagerTest.createProduction(newProduction);
    const production = productionManagerTest.getProduction(newProduction.name);

    expect(production?.name).toStrictEqual('productionname');
    expect(production?.lines[0].name).toStrictEqual('linename');
    expect(production?.lines[0].id).toStrictEqual('');
    expect(production?.lines[0].connections).toStrictEqual({});
  });
});

describe('production_manager', () => {
  it('creating an already existing production throws error', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    productionManagerTest.createProduction(newProduction);

    () => {
      expect(() => {
        productionManagerTest.createProduction(newProduction);
      }).toThrow();
    };
  });
});

describe('production_manager', () => {
  it('creates production object then gets entire productions list from class instance', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    const production: Production = {
      name: 'productionname',
      lines: [
        {
          name: 'linename',
          id: '',
          connections: {}
        }
      ]
    };

    expect(productionManagerTest.getProductions()).toStrictEqual([]);
    productionManagerTest.createProduction(newProduction);
    const productions = productionManagerTest.getProductions();
    expect(productions).toStrictEqual([production]);
  });
});

describe('production_manager', () => {
  it('getting non existent production object returns undefined', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    productionManagerTest.createProduction(newProduction);
    const nonExistentProduction = productionManagerTest.getProduction('null');
    expect(nonExistentProduction).toStrictEqual(undefined);
  });
});

describe('production_manager', () => {
  it('deleting production object removes it from class instance', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction1: NewProduction = {
      name: 'productionname1',
      lines: [
        {
          name: 'linename1'
        }
      ]
    };

    const newProduction2: NewProduction = {
      name: 'productionname2',
      lines: [
        {
          name: 'linename2'
        }
      ]
    };

    const production1: Production = {
      name: 'productionname1',
      lines: [
        {
          name: 'linename1',
          id: '',
          connections: {}
        }
      ]
    };

    const production2: Production = {
      name: 'productionname2',
      lines: [
        {
          name: 'linename2',
          id: '',
          connections: {}
        }
      ]
    };

    productionManagerTest.createProduction(newProduction1);
    productionManagerTest.createProduction(newProduction2);
    expect(productionManagerTest.getProductions()).toStrictEqual([
      production1,
      production2
    ]);
    productionManagerTest.deleteProduction('productionname1');
    expect(productionManagerTest.getProductions()).toStrictEqual([production2]);
  });
});

describe('production_manager', () => {
  it('deleting non existent production object returns undefined', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    const production = productionManagerTest.createProduction(newProduction);
    expect(productionManagerTest.getProductions()).toStrictEqual([production]);
    productionManagerTest.deleteProduction('productionname');
    expect(productionManagerTest.getProductions()).toStrictEqual([]);
    expect(
      productionManagerTest.deleteProduction('productionname')
    ).toStrictEqual(undefined);
  });
});

describe('production_manager', () => {
  it('get lines, set new id, then get lines and confirm change', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    productionManagerTest.createProduction(newProduction);
    const lineIdBefore =
      productionManagerTest.getProduction('productionname')?.lines[0].id;
    expect(lineIdBefore).toStrictEqual('');
    productionManagerTest.setLineId('productionname', 'linename', 'newLineId');
    const lineIdAfter =
      productionManagerTest.getProduction('productionname')?.lines[0].id;
    expect(lineIdAfter).toStrictEqual('newLineId');
  });
});

describe('production_manager', () => {
  it('set new line id returns undefined if line is not found', async () => {
    const productionManagerTest = new ProductionManager();

    const noline = productionManagerTest.setLineId(
      'productionname',
      'no_linename',
      'newLineId'
    );
    expect(noline).toStrictEqual(undefined);
  });
});

describe('production_manager', () => {
  it('add an endpoint description to line connections', async () => {
    const productionManagerTest = new ProductionManager();

    const newProduction: NewProduction = {
      name: 'productionname',
      lines: [
        {
          name: 'linename'
        }
      ]
    };

    productionManagerTest.createProduction(newProduction);
    productionManagerTest.addConnectionToLine(
      'productionname',
      'linename',
      'username',
      SmbEndpointDescriptionMock
    );
    const productionLines =
      productionManagerTest.getProduction('productionname')?.lines;
    if (!productionLines) {
      fail('Test failed due to productionLines being undefined');
    }
    const endpointDescription = productionManagerTest.getLine(
      productionLines,
      'linename'
    )?.connections['username'];
    expect(endpointDescription).toStrictEqual(SmbEndpointDescriptionMock);
  });
});
