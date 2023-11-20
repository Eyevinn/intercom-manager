import { Static } from '@sinclair/typebox';
import { NewProduction, Production, Line } from './models';
import { SmbEndpointDescription } from './smb';

type NewProduction = Static<typeof NewProduction>;
type Production = Static<typeof Production>;
type Line = Static<typeof Line>;

export class ProductionManager {
  private productions: Production[];

  constructor() {
    this.productions = [];
  }

  async createProduction(
    newProduction: NewProduction
  ): Promise<Production | undefined> {
    if (!this.getProduction(newProduction.name)) {
      const newProductionLines: Line[] = [];

      for (const line of newProduction.lines) {
        const newProductionLine: Line = {
          name: line.name,
          id: '',
          connections: {}
        };
        newProductionLines.push(newProductionLine);
      }
      const production: Production = {
        name: newProduction.name,
        lines: newProductionLines
      };
      if (production) {
        this.productions.push(production);
        return production;
      } else {
        throw new Error(
          `Create production failed, Production object error ${production}`
        );
      }
    } else {
      throw new Error(
        `Create production failed, Production ${newProduction.name} already exists`
      );
    }
  }

  getProductions(): Production[] {
    return this.productions;
  }

  getProduction(productionName: string): Production | undefined {
    const matchedProduction = this.productions.find(
      (production) => production.name === productionName
    );
    if (matchedProduction) {
      return matchedProduction;
    } else {
      return undefined;
    }
  }

  setLineId(productionName: string, lineName: string, lineId: string): void {
    const matchedProduction = this.productions.find(
      (production) => production.name === productionName
    );
    if (matchedProduction) {
      const line = this.getLine(matchedProduction.lines, lineName);
      if (line) {
        line.id = lineId;
      }
    }
  }

  getLine(lines: Line[], lineName: string): Line | undefined {
    const matchedLine = lines.find((line) => line.name === lineName);
    if (matchedLine) {
      return matchedLine;
    }
    return undefined;
  }

  addConnectionToLine(
    productionName: string,
    lineName: string,
    userName: string,
    endpointDescription: SmbEndpointDescription
  ): void {
    const production = this.getProduction(productionName);
    if (production) {
      const matchedLine = production.lines.find(
        (line) => line.name === lineName
      );
      if (matchedLine) {
        matchedLine.connections[userName] = endpointDescription;
      }
    } else {
      throw new Error(
        `Adding connection failed, Production ${productionName} does not exist`
      );
    }
  }
}
