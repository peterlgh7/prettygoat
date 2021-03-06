import {interfaces} from "inversify";
import IServiceLocator from "../ioc/IServiceLocator";
import IProjectionRegistry from "../registry/IProjectionRegistry";

interface IModule {
    modules?:(container:interfaces.Container) => void;
    register(registry:IProjectionRegistry, serviceLocator?:IServiceLocator, overrides?:any):void;
}

export default IModule;
