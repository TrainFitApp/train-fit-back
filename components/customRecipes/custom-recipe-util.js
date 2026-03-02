module.exports = {
  compareObjects(obj1, obj2) {
    // Obtiene las claves de propiedades de ambos objetos
    var propsObj1 = Object.keys(obj1);
    var propsObj2 = Object.keys(obj2);
  
    // Comprueba si la cantidad de propiedades es la misma
    if (propsObj1.length !== propsObj2.length) {
      return false;
    }
  
    // Compara cada propiedad y su valor en ambos objetos
    for (var i = 0; i < propsObj1.length; i++) {
      var propName = propsObj1[i];
  
      // Comprueba si la propiedad existe en el segundo objeto
      if (!obj2.hasOwnProperty(propName)) {
        return false;
      }
  
      // Comprueba si los valores de las propiedades son diferentes
      if (obj1[propName] !== obj2[propName]) {
        return false;
      }
    }
  
    // Los objetos son iguales
    return true;
  }
};
