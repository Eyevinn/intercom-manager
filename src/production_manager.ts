import {
  NewProduction,
  Production,
  Line,
  SmbEndpointDescription
} from './models';

export class ProductionManager {
  private productions: Production[];

  constructor() {
    this.productions = [];
  }

  createProduction(newProduction: NewProduction): Production | undefined {
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

  deleteProduction(productionName: string): string | undefined {
    const matchedProductionIndex: number = this.productions.findIndex(
      (production) => production.name === productionName
    );
    if (matchedProductionIndex != -1) {
      if (this.productions.splice(matchedProductionIndex, 1)) {
        return productionName;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  setLineId(
    productionName: string,
    lineName: string,
    lineId: string
  ): Line | undefined {
    const matchedProduction = this.getProduction(productionName);
    if (matchedProduction) {
      const line = this.getLine(matchedProduction.lines, lineName);
      if (line) {
        line.id = lineId;
        return line;
      } else {
        return undefined;
      }
    } else {
      return undefined;
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
    endpointDescription: SmbEndpointDescription,
    endpointId: string
  ): void {
    const production = this.getProduction(productionName);
    if (production) {
      const matchedLine = production.lines.find(
        (line) => line.name === lineName
      );
      if (matchedLine) {
        matchedLine.connections[userName] = {
          sessionDescription: endpointDescription,
          endpointId: endpointId
        };
      }
    } else {
      throw new Error(
        `Adding connection failed, Production ${productionName} does not exist`
      );
    }
  }

  removeConnectionFromLine(
    productionName: string,
    lineName: string,
    userName: string
  ): string | undefined {
    const production = this.getProduction(productionName);
    if (production) {
      const matchedLine = production.lines.find(
        (line) => line.name === lineName
      );
      if (matchedLine?.connections) {
        delete matchedLine.connections[userName];
        return userName;
      }
    } else {
      throw new Error(
        `Deleting connection failed, Production ${productionName} does not exist`
      );
    }
  }
}
