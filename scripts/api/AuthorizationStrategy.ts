import IAuthorizationStrategy from "./IAuthorizationStrategy";
import {injectable, inject, optional} from 'inversify';
import * as _ from "lodash";
import * as Promise from "bluebird";
import {Request} from 'express';
import IAuthorizationConfig from "../configs/IApiKeyConfig";

@injectable()
class AuthorizationStrategy implements IAuthorizationStrategy {
    constructor(@inject("TokenCollection") @optional() private tokenCollection: IAuthorizationConfig = []) {
    }

    authorize(request: Request): Promise<boolean> {
        return Promise.resolve(_.includes(this.tokenCollection, request.header("Authorization")));
    }
}

export default AuthorizationStrategy;