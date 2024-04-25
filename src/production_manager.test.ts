import { ProductionManager } from './production_manager';
import {
  NewProduction,
  Production,
  SmbEndpointDescription,
  UserSession
} from './models';
import dbManager from './db_manager';

const newProduction: NewProduction = {
  name: 'productionname',
  lines: [
    {
      name: 'linename'
    }
  ]
};

const existingProduction: Production = {
  _id: 1,
  name: 'productionname',
  lines: [
    {
      name: 'linename',
      id: '1',
      smbconferenceid: 'smbineid'
    }
  ]
};

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

jest.mock('./db_manager', () => ({
  addProduction: jest.fn(),
  getProduction: jest.fn(),
  getProductions: jest.fn(),
  deleteProduction: jest.fn()
}));

beforeEach(() => {
  jest.resetAllMocks();
});

describe('production_manager', () => {
  it('calls the dbManager when you try to create a production', async () => {
    const { getProduction } = jest.requireMock('./db_manager');
    getProduction.mockReturnValueOnce(undefined).mockReturnValue(newProduction);

    const productionManagerTest = new ProductionManager();

    const spyAddProduction = jest.spyOn(dbManager, 'addProduction');

    await productionManagerTest.createProduction(newProduction);
    expect(spyAddProduction).toHaveBeenCalledTimes(1);
  });
});

describe('production_manager', () => {
  it('creating an already existing production throws error', async () => {
    const { getProduction } = jest.requireMock('./db_manager');
    getProduction
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(newProduction)
      .mockReturnValueOnce(existingProduction);

    const productionManagerTest = new ProductionManager();

    await productionManagerTest.createProduction(newProduction);

    () => {
      expect(async () => {
        await productionManagerTest.createProduction(newProduction);
      }).toThrow();
    };
  });
});

describe('production_manager', () => {
  it('creates production object then gets entire productions list from class instance', async () => {
    const { getProduction, getProductions } = jest.requireMock('./db_manager');
    getProduction.mockReturnValueOnce(undefined);
    getProductions
      .mockReturnValueOnce([])
      .mockReturnValueOnce([existingProduction]);

    const productionManagerTest = new ProductionManager();

    expect(await productionManagerTest.getProductions()).toStrictEqual([]);
    await productionManagerTest.createProduction(newProduction);
    const productions = await productionManagerTest.getProductions();
    expect(productions).toStrictEqual([existingProduction]);
  });
});

describe('production_manager', () => {
  it('getting non existent production object returns undefined', async () => {
    const { getProduction } = jest.requireMock('./db_manager');
    getProduction.mockReturnValueOnce(undefined);

    const productionManagerTest = new ProductionManager();

    const nonExistentProduction = await productionManagerTest.getProduction(-1);
    expect(nonExistentProduction).toStrictEqual(undefined);
  });
});

describe('production_manager', () => {
  it('deleting production object removes it from class instance', async () => {
    const production1: Production = {
      _id: 1,
      name: 'productionname1',
      lines: [
        {
          name: 'linename1',
          id: '1',
          smbconferenceid: ''
        }
      ]
    };

    const production2: Production = {
      _id: 2,
      name: 'productionname2',
      lines: [
        {
          name: 'linename2',
          id: '1',
          smbconferenceid: ''
        }
      ]
    };

    const { getProduction, getProductions, deleteProduction } =
      jest.requireMock('./db_manager');
    getProduction.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    getProductions
      .mockReturnValueOnce([production1, production2])
      .mockReturnValueOnce([production2]);
    deleteProduction.mockReturnValueOnce(true);

    const productionManagerTest = new ProductionManager();

    expect(await productionManagerTest.getProductions()).toStrictEqual([
      production1,
      production2
    ]);
    expect(await productionManagerTest.deleteProduction('1')).toStrictEqual(
      true
    );
    expect(await productionManagerTest.getProductions()).toStrictEqual([
      production2
    ]);
  });
});

describe('production_manager', () => {
  it('deleting non existent production object returns false', async () => {
    const { getProductions, deleteProduction } =
      jest.requireMock('./db_manager');
    getProductions.mockReturnValueOnce([]);
    deleteProduction.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const productionManagerTest = new ProductionManager();

    expect(await productionManagerTest.deleteProduction('1')).toStrictEqual(
      true
    );
    expect(await productionManagerTest.getProductions()).toStrictEqual([]);
    expect(await productionManagerTest.deleteProduction('1')).toStrictEqual(
      false
    );
  });
});

describe('production_manager', () => {
  it('add an endpoint description to line connections', async () => {
    const { getProduction } = jest.requireMock('./db_manager');
    getProduction.mockReturnValueOnce(existingProduction);

    const productionManagerTest = new ProductionManager();

    productionManagerTest.createUserSession('1', '1', 'sessionId', 'userName');
    productionManagerTest.updateUserEndpoint(
      'sessionId',
      'endpointId',
      SmbEndpointDescriptionMock
    );
    const production = await productionManagerTest.getProduction(1);
    const productionLines = production?.lines;
    if (!productionLines) {
      fail('Test failed due to productionLines being undefined');
    }

    const userSession: UserSession | undefined =
      productionManagerTest.getUser('sessionId');
    expect(userSession);

    expect(userSession?.sessionDescription).toStrictEqual(
      SmbEndpointDescriptionMock
    );
    expect(userSession?.endpointId).toStrictEqual('endpointId');
    expect(userSession?.name).toStrictEqual('userName');
    expect(userSession?.isActive).toStrictEqual(true);
    expect(userSession?.isExpired).toStrictEqual(false);
  });
});
